import type { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { uuidToBytes } from '@al-yo-bo/shared';

import { checkpoint, openDatabase } from './connection.ts';
import { setupDatabase } from './migrations.ts';
import { assignTag } from './queries/bookmark-tags.ts';
import { upsertBookmarkByUrl } from './queries/bookmarks.ts';
import { createCategory, getCategoryByName } from './queries/categories.ts';
import {
  clearDatasetContent,
  createDataset,
  getDatasetByName,
  type DatasetContentCounts,
} from './queries/datasets.ts';
import { createTag, getTagByName } from './queries/tags.ts';

/** Seed datasets live in `packages/db/seeds/datasets/<name>.seed.json`. */
export const SEED_DATASETS_DIR = join(import.meta.dir, '../seeds/datasets');

/** Dataset `bun run db:seed` loads when `SEED_DATASET` is unset. */
export const DEFAULT_DATASET = 'leo';

export const DEFAULT_SEED_PATH = join(SEED_DATASETS_DIR, 'leo.seed.json');

export interface SeedDataset {
  /** Dataset name used in `SEED_DATASET`. */
  name: string;
  /** File name inside `SEED_DATASETS_DIR`. */
  file: string;
  /** Reserved datasets are listed for selection but refuse to load until wired up. */
  implemented: boolean;
}

/**
 * Known seed datasets. `leo` (the default) is Leo's real collections imported
 * from `docs/examples-mds/`; its fixture is regenerated with
 * `bun run scripts/extract-leo-seed.ts`. `grimoire` is the synthetic Grimoire
 * demo fixture the tests use. Datasets must be registered here — dropping a file
 * in the directory does not make it selectable.
 */
const DATASETS: SeedDataset[] = [
  { name: 'leo', file: 'leo.seed.json', implemented: true },
  { name: 'grimoire', file: 'grimoire.seed.json', implemented: true },
];

export class UnknownSeedDatasetError extends Error {
  constructor(name: string) {
    const known = DATASETS.map((d) =>
      d.implemented ? d.name : `${d.name} (not yet implemented)`,
    ).join(', ');
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
  /** Dataset name the fixture loads into (created on demand). */
  dataset: string;
  categories: string[];
  tags: string[];
  bookmarks: SeedBookmark[];
}

export interface SeedReport {
  datasetCreated: boolean;
  categoriesCreated: number;
  tagsCreated: number;
  bookmarksAdded: number;
  bookmarksUpdated: number;
  assignments: number;
}

/**
 * Empties one dataset's content so a fixture load starts from a clean slate.
 * Delegates to `clearDatasetContent`, which owns the deletion semantics: child
 * rows (assignments, scraped content, embeddings, classification evidence)
 * cascade via foreign keys (connection PRAGMAs keep FKs on), and the
 * `bookmarks_fts_delete` trigger removes FTS rows as bookmarks go, so no
 * reindex pass is needed. Strictly scoped to the named dataset — other
 * datasets are never touched. The dataset row itself is kept (created on
 * demand) so the fixture load can reuse the name.
 */
export function resetSeedData(db: Database, datasetName: string): DatasetContentCounts {
  const dataset = getDatasetByName(db, datasetName) ?? createDataset(db, datasetName);
  return clearDatasetContent(db, dataset.id);
}

/**
 * Loads a seed fixture (default: the `leo` dataset). Idempotent: the fixture's
 * dataset, categories and tags are reused by name and bookmarks are upserted by
 * URL. Everything is scoped to the fixture's dataset.
 */
export function seedFromFile(db: Database, filePath = DEFAULT_SEED_PATH): SeedReport {
  const seed = JSON.parse(readFileSync(filePath, 'utf8')) as SeedFile;
  const report: SeedReport = {
    datasetCreated: false,
    categoriesCreated: 0,
    tagsCreated: 0,
    bookmarksAdded: 0,
    bookmarksUpdated: 0,
    assignments: 0,
  };

  const insideTransaction = db.transaction(() => {
    const existing = getDatasetByName(db, seed.dataset);
    const dataset = existing ?? createDataset(db, seed.dataset);
    report.datasetCreated = !existing;

    for (const name of seed.categories) {
      if (!getCategoryByName(db, dataset.id, name)) {
        report.categoriesCreated += 1;
      }
      createCategory(db, { datasetId: dataset.id, name });
    }

    for (const name of seed.tags) {
      if (!getTagByName(db, dataset.id, name, null)) {
        report.tagsCreated += 1;
      }
      createTag(db, { datasetId: dataset.id, name });
    }

    for (const entry of seed.bookmarks) {
      let categoryId: string | null = null;
      if (entry.category) {
        const category =
          getCategoryByName(db, dataset.id, entry.category) ??
          createCategory(db, { datasetId: dataset.id, name: entry.category });
        categoryId = category.id;
      }

      const { bookmark, created } = upsertBookmarkByUrl(db, {
        datasetId: dataset.id,
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
        const tag = getTagByName(db, dataset.id, tagName, null);
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
  const datasetName = process.env.SEED_DATASET || DEFAULT_DATASET;
  const filePath = resolveSeedDataset(datasetName);
  if (process.env.SEED_RESET === '1') {
    const counts = resetSeedData(db, datasetName);
    console.log(`Reset existing content in dataset "${datasetName}" (SEED_RESET=1)`);
    console.log(JSON.stringify(counts, null, 2));
  }

  const report = seedFromFile(db, filePath);
  checkpoint(db);
  console.log(`Seeded database from dataset "${datasetName}" (${filePath})`);
  console.log(JSON.stringify(report, null, 2));
}
