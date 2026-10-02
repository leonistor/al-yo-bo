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
import { updateProfile } from './queries/profile.ts';
import { createTag, getTagByName } from './queries/tags.ts';

/** Seed datasets live in `packages/db/seeds/datasets/<name>.seed.json`. */
export const SEED_DATASETS_DIR = join(import.meta.dir, '../seeds/datasets');

/**
 * Seed fixture `bun run db:seed` loads when `SEED_DATASET` is unset. Distinct
 * from the server's `DEFAULT_DATASET` (which dataset the app scopes to): this
 * one picks which fixture to load. The two env names must never merge again.
 */
export const DEFAULT_SEED_DATASET = 'leo';

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
  /**
   * Optional identity for the singleton profile (e.g. "leo"). Set when the
   * fixture represents the single user's own collection; synthetic demo
   * fixtures (grimoire) omit it and leave the profile name untouched.
   */
  profileName?: string;
  categories: string[];
  tags: string[];
  bookmarks: SeedBookmark[];
}

export interface SeedReport {
  /** Id of the dataset the fixture landed in — the activation pointer target. */
  datasetId: string;
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
    datasetId: '',
    datasetCreated: false,
    categoriesCreated: 0,
    tagsCreated: 0,
    bookmarksAdded: 0,
    bookmarksUpdated: 0,
    assignments: 0,
  };

  const insideTransaction = db.transaction(() => {
    if (seed.profileName) {
      // The fixture names the user (identity), not just the dataset (content
      // workspace) — MODEL.md keeps the two orthogonal, so seed both.
      updateProfile(db, { name: seed.profileName });
    }
    const existing = getDatasetByName(db, seed.dataset);
    const dataset = existing ?? createDataset(db, seed.dataset);
    report.datasetId = dataset.id;
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

export interface SeedOptions {
  /** Wipe the target dataset's content before loading (env `SEED_RESET`). */
  reset?: boolean;
  /**
   * Set the profile's active-dataset pointer to the seeded dataset (env
   * `SEED_ACTIVATE`, on by default). Seeding is the user's dataset-switch
   * mechanism: loading a dataset means starting to use it.
   */
  activate?: boolean;
}

export interface SeedRun {
  report: SeedReport;
  /** True when the profile's active-dataset pointer was set to the target. */
  activated: boolean;
  /** Fixture path that was loaded (already validated by `resolveSeedDataset`). */
  filePath: string;
  /** Rows removed by the pre-load reset, when `options.reset` was set. */
  resetCounts?: DatasetContentCounts;
}

/**
 * Loads a registered seed fixture into its dataset — the compose step the
 * `db:seed` CLI runs. Reset (when asked) and activation (by default) are part
 * of the same run so a seed always leaves the database in a coherent state.
 */
export function seedDataset(db: Database, name: string, options: SeedOptions = {}): SeedRun {
  const filePath = resolveSeedDataset(name);
  const resetCounts = options.reset ? resetSeedData(db, name) : undefined;
  const report = seedFromFile(db, filePath);
  let activated = false;
  if (options.activate !== false) {
    updateProfile(db, { activeDatasetId: report.datasetId });
    activated = true;
  }
  return { report, activated, filePath, resetCounts };
}

if (import.meta.main) {
  const db = openDatabase();
  setupDatabase(db);

  // Bun auto-loads the repo-root .env, so SEED_DATASET/SEED_RESET/SEED_ACTIVATE
  // work via `bun run db:seed` with no extra wiring (.env.example documents
  // all three; ARCHITECTURE §7 covers them in the same change set).
  const datasetName = process.env.SEED_DATASET || DEFAULT_SEED_DATASET;
  const { report, activated, filePath, resetCounts } = seedDataset(db, datasetName, {
    reset: process.env.SEED_RESET === '1',
    activate: process.env.SEED_ACTIVATE !== '0',
  });
  checkpoint(db);
  if (resetCounts) {
    console.log(`Reset existing content in dataset "${datasetName}" (SEED_RESET=1)`);
    console.log(JSON.stringify(resetCounts, null, 2));
  }
  console.log(`Seeded database from dataset "${datasetName}" (${filePath})`);
  console.log(JSON.stringify(report, null, 2));
  if (activated) {
    console.log(
      `Active dataset is now "${datasetName}" (profile.active_dataset_id) — the server scopes to it on the next boot. Set SEED_ACTIVATE=0 to load without switching.`,
    );
  }
}
