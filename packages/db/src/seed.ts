import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { uuidToBytes } from '@al-yo-bo/shared';

import { checkpoint, openDatabase } from './connection.ts';
import { setupDatabase } from './migrations.ts';
import { assignTag } from './queries/bookmark-tags.ts';
import { upsertBookmarkByUrl } from './queries/bookmarks.ts';
import { createCategory, getCategoryByName } from './queries/categories.ts';
import { createTag, getTagByName } from './queries/tags.ts';

export const DEFAULT_SEED_PATH = join(import.meta.dir, '../seeds/grimoire-demo.seed.json');

interface SeedBookmark {
  url: string;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  createdAt: number;
  metadata: Record<string, unknown>;
}

interface SeedFile {
  categories: string[];
  tags: string[];
  bookmarks: SeedBookmark[];
}

export interface SeedReport {
  categoriesCreated: number;
  tagsCreated: number;
  bookmarksAdded: number;
  bookmarksUpdated: number;
  assignments: number;
}

/**
 * Loads a seed fixture (default: the synthetic Grimoire demo dataset). Idempotent:
 * categories and tags are reused by name and bookmarks are upserted by URL.
 */
export function seedFromFile(db: Database, filePath = DEFAULT_SEED_PATH): SeedReport {
  const seed = JSON.parse(readFileSync(filePath, 'utf8')) as SeedFile;
  const report: SeedReport = {
    categoriesCreated: 0,
    tagsCreated: 0,
    bookmarksAdded: 0,
    bookmarksUpdated: 0,
    assignments: 0,
  };

  const insideTransaction = db.transaction(() => {
    for (const name of seed.categories) {
      if (!getCategoryByName(db, name)) {
        report.categoriesCreated += 1;
      }
      createCategory(db, { name });
    }

    for (const name of seed.tags) {
      if (!getTagByName(db, name, null)) {
        report.tagsCreated += 1;
      }
      createTag(db, { name, status: 'active' });
    }

    for (const entry of seed.bookmarks) {
      let categoryId: string | null = null;
      if (entry.category) {
        const category = getCategoryByName(db, entry.category) ?? createCategory(db, { name: entry.category });
        categoryId = category.id;
      }

      const { bookmark, created } = upsertBookmarkByUrl(db, {
        url: entry.url,
        title: entry.title,
        description: entry.description,
        metadata: entry.metadata,
        categoryId,
      });
      if (created) {
        report.bookmarksAdded += 1;
        // Seed fixtures carry historical dates; set them after insert because the
        // timestamp trigger forces created_at to server time on INSERT.
        db.query('UPDATE bookmarks SET created_at = ? WHERE id = ?').run(
          entry.createdAt,
          uuidToBytes(bookmark.id),
        );
      } else {
        report.bookmarksUpdated += 1;
      }

      for (const tagName of entry.tags) {
        const tag = getTagByName(db, tagName, null);
        if (tag) {
          assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'import' });
          report.assignments += 1;
        }
      }
    }
  });

  insideTransaction.immediate();
  return report;
}

if (import.meta.main) {
  const db = openDatabase();
  setupDatabase(db);
  const report = seedFromFile(db);
  checkpoint(db);
  console.log(`Seeded database from ${DEFAULT_SEED_PATH}`);
  console.log(JSON.stringify(report, null, 2));
}
