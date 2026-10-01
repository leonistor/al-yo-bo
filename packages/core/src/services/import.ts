import type { Database } from 'bun:sqlite';

import {
  fallbackExtraction,
  ingestBookmarks,
  parseCollection,
  resolveVocabulary,
  type ExtractionClient,
  type ExtractionResult,
  type IngestReport,
} from '@al-yo-bo/importer';
import { isHttpUrl, type ImportedBookmark } from '@al-yo-bo/shared';

import type { JobScheduler } from './enrichment.ts';

export interface ImportPreview extends ExtractionResult {
  /** Re-run of the deterministic parser — cheap, used to report `skipped` lines. */
  parsed: number;
  skipped: number;
  bookmarks: ImportedBookmark[];
}

export interface ImportOptions {
  file?: string;
}

export interface ImportServiceDeps {
  db: Database;
  jobs: JobScheduler;
  /** LLM-backed extraction; `null` falls back to the deterministic parser. */
  extract: ExtractionClient | null;
}

export interface ImportService {
  /**
   * Extraction preview (ARCHITECTURE §7 stage 1, post-simplification). Never
   * writes — used by the Import page's "Extract" button before commit.
   */
  preview(text: string): Promise<ImportPreview>;
  /**
   * Commits a user-reviewed (and possibly edited) bookmark list without
   * re-extracting. Resolves vocabulary (auto-creating missing entries as
   * active), ingests, and enqueues enrichment for newly added bookmarks.
   * Returns the `ImportReport` verbatim — callers surface `added`/`updated`.
   */
  commit(
    bookmarks: ImportedBookmark[],
    datasetId: string,
    options?: ImportOptions,
  ): IngestReport;
}

/**
 * Markdown collection import (ARCHITECTURE §7 stage 1, post-simplification).
 * The extraction path (LLM or deterministic fallback) is followed by a single
 * ingest pass that auto-creates any missing vocabulary as active.
 *
 * No staging, no review, no proposals. The user reviews and edits the preview
 * in the UI before the import button commits.
 */
export function createImportService(deps: ImportServiceDeps): ImportService {
  const { db, jobs, extract } = deps;

  async function extractBookmarks(text: string): Promise<ExtractionResult> {
    if (!extract) {
      const { bookmarks, skipped } = parseCollection(text);
      return { bookmarks, provider: 'fallback', warnings: skipped > 0 ? [] : undefined };
    }
    try {
      const bookmarks = await extract.extract(text);
      return { bookmarks, provider: 'llm' };
    } catch (error) {
      console.warn('[import] extraction failed, falling back to deterministic parser', error);
      return {
        bookmarks: fallbackExtraction(text),
        provider: 'fallback',
        warnings: ['LLM extraction failed; falling back to deterministic parser.'],
      };
    }
  }

  function enqueueScrapes(report: { addedIds: string[] }): void {
    for (const id of report.addedIds) {
      jobs.enqueue(id, 'scrape');
      jobs.enqueue(id, 'screenshot');
    }
  }

  return {
    async preview(text) {
      const extraction = await extractBookmarks(text);
      const parsed = parseCollection(text);
      return {
        ...extraction,
        parsed: parsed.bookmarks.length,
        skipped: parsed.skipped,
        bookmarks: extraction.bookmarks,
      };
    },

    commit(bookmarks, datasetId, options = {}) {
      // Validate before ingest/normalization: a non-HTTP(S) URL would crash the
      // ingest transaction with a raw `new URL()` throw from normalizeUrl.
      // Invalid rows are skipped into the report instead.
      const valid: ImportedBookmark[] = [];
      const invalidUrlWarnings: string[] = [];
      for (const entry of bookmarks) {
        if (isHttpUrl(entry.url)) {
          valid.push(entry);
        } else {
          invalidUrlWarnings.push(`Skipped bookmark with invalid URL: ${entry.url}`);
        }
      }
      const resolution = resolveVocabulary(db, datasetId, valid);
      const report = ingestBookmarks(db, datasetId, valid, resolution, {
        file: options.file,
        // Reviewed list, except rows rejected above for an invalid URL.
        skipped: invalidUrlWarnings.length,
      });
      if (invalidUrlWarnings.length > 0 || report.warnings?.length) {
        report.warnings = [...invalidUrlWarnings, ...(report.warnings ?? [])];
      }
      enqueueScrapes(report);
      return report;
    },
  };
}
