import type { Database } from 'bun:sqlite';

import {
  fallbackExtraction,
  ingestBookmarks,
  parseCollection,
  resolveVocabulary,
  type ExtractionClient,
  type ExtractionResult,
} from '@al-yo-bo/importer';
import type { ImportedBookmark } from '@al-yo-bo/shared';

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
  /** Direct-commit import: resolves vocabulary, ingests, enqueues enrichment. */
  import(text: string, datasetId: string, options?: ImportOptions): Promise<ImportPreview>;
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

    async import(text, datasetId, options = {}) {
      const extraction = await extractBookmarks(text);
      const parsed = parseCollection(text);
      const bookmarks = extraction.bookmarks;
      const resolution = resolveVocabulary(db, datasetId, bookmarks);
      const report = ingestBookmarks(db, datasetId, bookmarks, resolution, {
        file: options.file,
        skipped: parsed.skipped,
      });
      enqueueScrapes(report);
      return {
        ...extraction,
        parsed: parsed.bookmarks.length,
        skipped: parsed.skipped,
        bookmarks,
      };
    },
  };
}
