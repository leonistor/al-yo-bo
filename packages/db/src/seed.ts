import type { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { uuidToBytes } from '@al-yo-bo/shared';

import { checkpoint, openDatabase } from './connection.ts';
import { setupDatabase } from './migrations.ts';
import { assignTag } from './queries/bookmark-tags.ts';
import { upsertBookmarkByUrl } from './queries/bookmarks.ts';
import { createCategory, getCategoryByName } from './queries/categories.ts';
import { createTag, getTagByName } from './queries/tags.ts';

/** Seed datasets live in `packages/db/seeds/datasets/<name>.seed.json`. */
export const SEED_DATASETS_DIR = join(import.meta.dir, '../seeds/datasets');

export const DEFAULT_SEED_PATH = join(SEED_DATASETS_DIR, 'grimoire.seed.json');

export interface SeedDataset {
  /** Dataset name used in `SEED_DATASET`. */
  name: string;
  /** File name inside `SEED_DATASETS_DIR`. */
  file: string;
  /** Reserved datasets are listed for selection but refuse to load until wired up. */
  implemented: boolean;
}

/**
 * Known seed datasets. `grimoire` is the synthetic Grimoire demo fixture. `leo`
 * is reserved for Leo's real collections imported from `docs/examples-mds/` —
 * implementing it means generating its JSON via the importer; until then it
 * must stay `implemented: false` so selection fails with a clear message.
 */
const DATASETS: SeedDataset[] = [
  { name: 'grimoire', file: 'grimoire.seed.json', implemented: true },
  { name: 'leo', file: 'leo.seed.json', implemented: false },
];

export class UnknownSeedDatasetError extends Error {
  constructor(name: string) {
    const known = DATASETS.map((d) => (d.implemented ? d.name : `${d.name} (not yet implemented)`)).join(', ');
    super(`Unknown seed dataset "${name}". Available datasets: ${known}`);
    this.name = 'UnknownSeedDatasetError';
  }
}

/**
 * Resolves a dataset name to its seed file path. Unknown names throw
 * `UnknownSeedDatasetError`; reserved-but-unimplemented datasets throw a plain
 * error telling the user the dataset is planned but not wired up yet.
 */
export function resolveSeedDataset(name: string): string {
  const dataset = DATASETS.find((d) => d.name === name);
  if (!dataset) {
    throw new UnknownSeedDatasetError(name);
  }
  if (!dataset.implemented) {
    throw new Error(
      `Seed dataset "${name}" is not implemented yet — generate its seed file from docs/examples-mds/ via the importer first.`,
    );
  }
  const filePath = join(SEED_DATASETS_DIR, dataset.file);
  if (!existsSync(filePath)) {
    throw new Error(`Seed dataset "${name}" has no fixture at ${filePath}.`);
  }
  return filePath;
}

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
 * Empties all seed-able content so a dataset load starts from a clean slate.
 * Bookmarks, tags, and categories are the root tables; child rows (assignments,
 * scraped content, embeddings, classification evidence) cascade via foreign
 * keys (connection PRAGMAs keep FKs on), and the `bookmarks_fts_delete` trigger
 * removes FTS rows as bookmarks go, so no reindex pass is needed.
 */
export function resetSeedData(db: Database): void {
  db.transaction(() => {
    db.exec('DELETE FROM bookmarks; DELETE FROM tags; DELETE FROM categories;');
  }).immediate();
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

  // Bun auto-loads the repo-root .env, so SEED_DATASET/SEED_RESET work via
  // `bun run db:seed` with no extra wiring (.env.example documents both; the
  // README covers them in the same change set).
  const datasetName = process.env.SEED_DATASET || 'grimoire';
  const filePath = resolveSeedDataset(datasetName);
  if (process.env.SEED_RESET === '1') {
    resetSeedData(db);
    console.log(`Reset existing content (SEED_RESET=1)`);
  }

  const report = seedFromFile(db, filePath);
  checkpoint(db);
  console.log(`Seeded database from dataset "${datasetName}" (${filePath})`);
  console.log(JSON.stringify(report, null, 2));
}
