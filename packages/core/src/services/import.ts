import type { Database } from 'bun:sqlite';

import type { ExtractionClient } from '@al-yo-bo/ai';
import {
  commitImport,
  parseCollection,
  type IngestReport,
} from '@al-yo-bo/importer';
import { isHttpUrl, type ImportedBookmark } from '@al-yo-bo/shared';

import type { EventsSink } from '../events.ts';
import type { JobScheduler } from './enrichment.ts';

export interface ImportPreview {
  bookmarks: ImportedBookmark[];
  /** `'llm'` when the LLM extraction answered; `'fallback'` for the deterministic parser. */
  provider: 'llm' | 'fallback';
  warnings: string[];
  /** Deterministic parser counts — a cheap re-parse, used for the `parsed`/`skipped` stats. */
  parsed: number;
  skipped: number;
}

export interface ImportOptions {
  file?: string;
  /** Soft parser warnings (e.g. unrecognized frontmatter keys) to surface in the ingest report. */
  warnings?: string[];
}

export interface ImportServiceDeps {
  db: Database;
  jobs: JobScheduler;
  /** LLM-backed extraction; `null` falls back to the deterministic parser. */
  extract: ExtractionClient | null;
  events: EventsSink;
}

export interface ImportService {
  /**
   * Extraction preview (ARCHITECTURE §7 stage 1). Never writes — used by the
   * Import page's "Extract" button before commit. With no LLM client, or when
   * the LLM call fails, it falls back to the deterministic `parseCollection`
   * markdown parser (§1.5: import works without any sidecar).
   */
  preview(text: string): Promise<ImportPreview>;
  /**
   * Commits a user-reviewed (and possibly edited) bookmark list without
   * re-extracting. Resolves the vocabulary (auto-creating any missing category
   * or tag as active — MODEL.md principle 3), ingests, and enqueues enrichment
   * for newly added bookmarks. Returns the `ImportReport` verbatim — callers
   * surface `added`/`updated`.
   */
  commit(bookmarks: ImportedBookmark[], options?: ImportOptions): IngestReport;
}

/**
 * Markdown collection import (ARCHITECTURE §7 stage 1). The extraction path
 * (LLM or deterministic fallback) is followed by a single ingest pass that
 * auto-creates any missing vocabulary as active.
 *
 * No staging, no proposals. The user reviews and edits the preview in the UI
 * before the import button commits.
 */
export function createImportService(deps: ImportServiceDeps): ImportService {
  const { db, jobs, extract, events } = deps;

  async function extractBookmarks(text: string): Promise<{
    bookmarks: ImportedBookmark[];
    provider: 'llm' | 'fallback';
    warnings: string[];
  }> {
    if (!extract) {
      const parsed = parseCollection(text);
      return {
        bookmarks: parsed.bookmarks,
        provider: 'fallback',
        warnings: parsed.warnings ?? [],
      };
    }
    try {
      const result = await extract.extract(text);
      return { bookmarks: result.bookmarks, provider: 'llm', warnings: result.warnings };
    } catch (error) {
      console.warn('[import] extraction failed, falling back to deterministic parser', error);
      const parsed = parseCollection(text);
      return {
        bookmarks: parsed.bookmarks,
        provider: 'fallback',
        warnings: [
          'LLM extraction failed; falling back to deterministic parser.',
          ...(parsed.warnings ?? []),
        ],
      };
    }
  }

  return {
    async preview(text) {
      const extraction = await extractBookmarks(text);
      const parsed = parseCollection(text);
      return {
        bookmarks: extraction.bookmarks,
        provider: extraction.provider,
        warnings: extraction.warnings,
        parsed: parsed.bookmarks.length,
        skipped: parsed.skipped,
      };
    },

    commit(bookmarks, options = {}) {
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
      // ARCHITECTURE §7: vocabulary resolution and ingest run in one
      // transaction (commitImport). A mid-commit failure rolls the whole
      // import back instead of leaving a half-created vocabulary behind.
      const report = commitImport(db, valid, {
        file: options.file,
        // Reviewed list, except rows rejected above for an invalid URL.
        skipped: invalidUrlWarnings.length,
        warnings: invalidUrlWarnings.length > 0 ? invalidUrlWarnings : undefined,
      });
      for (const id of report.addedIds) {
        jobs.enqueue(id, 'scrape');
        jobs.enqueue(id, 'screenshot');
      }
      // One commit = three coarse hints (ARCHITECTURE §9): the import touches
      // bookmarks, the category tree (auto-created categories) and tags at once.
      events.emit({ topic: 'bookmarks.changed' });
      events.emit({ topic: 'categories.changed' });
      events.emit({ topic: 'tags.changed' });
      return report;
    },
  };
}
