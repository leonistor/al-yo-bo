import type { Database } from 'bun:sqlite';

import {
  createCategory,
  getCategoryByName,
  upsertBookmarkByUrl,
} from '@al-yo-bo/db';
import type { ImportReport, ImportedBookmark } from '@al-yo-bo/shared';

import { parseCollection } from './parse.ts';

export interface IngestOptions {
  file?: string;
  skipped?: number;
}

/** Upserts parsed bookmarks in one transaction, creating categories on demand. */
export function ingestBookmarks(
  db: Database,
  bookmarks: ImportedBookmark[],
  options: IngestOptions = {},
): ImportReport {
  const report: ImportReport = {
    added: 0,
    updated: 0,
    skipped: options.skipped ?? 0,
    categoriesCreated: 0,
    parsed: bookmarks.length,
    bookmarks,
    addedIds: [],
  };

  const insideTransaction = db.transaction(() => {
    for (const entry of bookmarks) {
      let categoryId: string | null = null;
      if (entry.category) {
        if (!getCategoryByName(db, entry.category)) {
          report.categoriesCreated += 1;
        }
        categoryId = createCategory(db, { name: entry.category }).id;
      }

      const metadata = {
        import: {
          file: options.file ?? null,
          section: entry.category,
          subsection: entry.subsection,
          priority: entry.priority,
        },
      };

      const { bookmark, created } = upsertBookmarkByUrl(db, {
        url: entry.url,
        title: entry.title,
        description: entry.description,
        categoryId,
        metadata,
      });

      if (created) {
        report.added += 1;
        report.addedIds.push(bookmark.id);
      } else {
        report.updated += 1;
      }
    }
  });

  insideTransaction.immediate();
  return report;
}

export function importMarkdown(
  db: Database,
  content: string,
  options: IngestOptions = {},
): ImportReport {
  const { bookmarks, skipped } = parseCollection(content);
  return ingestBookmarks(db, bookmarks, { ...options, skipped });
}
