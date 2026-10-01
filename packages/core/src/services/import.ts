import type { Database } from 'bun:sqlite';

import { importMarkdown, parseCollection } from '@al-yo-bo/importer';
import type { ImportedBookmark, ImportReport } from '@al-yo-bo/shared';

import type { JobScheduler } from './enrichment.ts';

export interface ImportPreview {
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
}

export interface ImportService {
  preview(markdown: string): ImportPreview;
  import(markdown: string, options?: ImportOptions): ImportReport;
}

/**
 * Markdown collection import. Preview never writes; import upserts and enqueues
 * a scrape for every newly created bookmark (updated ones keep their existing
 * enrichment pipeline state).
 */
export function createImportService(deps: ImportServiceDeps): ImportService {
  const { db, jobs } = deps;

  return {
    preview(markdown) {
      const { bookmarks, skipped } = parseCollection(markdown);
      return { parsed: bookmarks.length, skipped, bookmarks };
    },

    import(markdown, options = {}) {
      const report = importMarkdown(db, markdown, { file: options.file });
      // New bookmarks enter the enrichment pipeline; updated ones keep theirs.
      for (const id of report.addedIds) {
        jobs.enqueue(id, 'scrape');
      }
      return report;
    },
  };
}
