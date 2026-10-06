import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { uuidToBytes } from '@al-yo-bo/shared';

import { checkpoint, openDatabase } from './connection.ts';
import { setupDatabase } from './migrations.ts';
import { assignTag } from './queries/bookmark-tags.ts';
import { upsertBookmarkByUrl } from './queries/bookmarks.ts';
import { countCategories, createCategory } from './queries/categories.ts';
import { updateProfile } from './queries/profile.ts';
import { countTags, createTag, getTagByName } from './queries/tags.ts';

/**
 * Seed loader (MODEL.md §Seed & verification fixture). The canonical fixture is
 * the synthetic **octocat** demo: `seeds/octocat.seed.json` (v2 shape: a
 * category tree + ancestor-chain paths) and `seeds/octocat.md` (the tree-native
 * markdown source the import round-trip tests parse). This module is a pure
 * library — the `db:seed` script layer decides which fixture to load and how;
 * there are no SEED_DATASET/SEED_ACTIVATE/DEFAULT_DATASET env knobs anymore
 * (one workspace, MODEL.md principle 1).
 */

/** The canonical fixture shipped with the package. */
export const OCTOCAT_SEED_PATH = join(import.meta.dir, '../seeds/octocat.seed.json');

export interface SeedCategoryNode {
  name: string;
  description?: string | null;
  children?: SeedCategoryNode[];
}

export interface SeedBookmark {
  url: string;
  title: string | null;
  description: string | null;
  /** Ancestor chain from the root, e.g. `["Dev tools", "Editors"]` (v2 path grammar). */
  categoryPath: string[];
  tags: string[];
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface SeedFixture {
  /** Identity for the singleton profile (MODEL.md principle 8); omit to leave the profile untouched. */
  profileName?: string;
  githubUsername?: string;
  /** Category tree — roots with nested `children`. */
  categories: SeedCategoryNode[];
  /** Vocabulary seed beyond the tags referenced by bookmarks. */
  tags: string[];
  bookmarks: SeedBookmark[];
}

export interface SeedWipeCounts {
  bookmarks: number;
  tags: number;
  categories: number;
}

export interface SeedReport {
  /** Rows removed by the pre-load wipe, when `options.reset` was set. */
  wipe?: SeedWipeCounts;
  categoriesCreated: number;
  tagsCreated: number;
  bookmarksAdded: number;
  bookmarksUpdated: number;
  assignments: number;
}

export function loadSeedFixture(filePath: string = OCTOCAT_SEED_PATH): SeedFixture {
  return JSON.parse(readFileSync(filePath, 'utf8')) as SeedFixture;
}

/**
 * Empties the workspace so a fixture load starts from a clean slate (the ported
 * `clearDatasetContent` wipe, now unscoped — MODEL.md principle 1). Deletion
 * order is bookmarks → tags → categories: child rows (classification evidence,
 * assignments, embeddings) cascade via foreign keys (connection PRAGMAs keep
 * FKs on), the `bookmarks_fts_delete` trigger removes keyword rows as bookmarks
 * go, and the category self-FK cascade removes the whole tree while
 * `ON DELETE SET NULL` would spare surviving bookmarks — of which there are
 * none by then. Counts are taken before the deletes because `run().changes` is
 * not reliable once triggers fire.
 */
export function wipeContent(db: Database): SeedWipeCounts {
  const count = (sql: string): number => db.query<{ n: number }, []>(sql).get()?.n ?? 0;
  const counts: SeedWipeCounts = {
    bookmarks: count('SELECT COUNT(*) AS n FROM bookmarks'),
    tags: count('SELECT COUNT(*) AS n FROM tags'),
    categories: count('SELECT COUNT(*) AS n FROM categories'),
  };
  const run = db.transaction(() => {
    db.exec('DELETE FROM bookmarks; DELETE FROM tags; DELETE FROM categories;');
  });
  run.immediate();
  return counts;
}

/**
 * Resolves a category path against the tree, creating missing segments
 * `active` (the importer's vocabulary rule, MODEL.md principle 3 — the seed
 * exercises the same semantics).
 */
function resolveCategoryPath(db: Database, path: string[]): string | null {
  let parentId: string | null = null;
  for (const name of path) {
    const category = createCategory(db, { name, parentId });
    parentId = category.id;
  }
  return parentId;
}

/**
 * Loads a seed fixture into the one workspace. Wipe (default on) runs first so
 * a seed always leaves the database in a coherent state; `reset: false` merges
 * instead — categories/tags reuse by name and bookmarks upsert by URL. The
 * profile row is preserved (it is the person, never deletable) and updated
 * with the fixture's identity when one is given.
 */
export function seedDatabase(
  db: Database,
  fixture: SeedFixture,
  options: { reset?: boolean } = {},
): SeedReport {
  const report: SeedReport = {
    categoriesCreated: 0,
    tagsCreated: 0,
    bookmarksAdded: 0,
    bookmarksUpdated: 0,
    assignments: 0,
  };

  const insideTransaction = db.transaction(() => {
    if (options.reset !== false) {
      report.wipe = wipeContent(db);
    }

    if (fixture.profileName !== undefined) {
      updateProfile(db, {
        name: fixture.profileName,
        ...(fixture.githubUsername !== undefined ? { githubUsername: fixture.githubUsername } : {}),
      });
    }

    // Seed marks setup complete unconditionally; the setup wizard is not
    // replayed after a fixture load.
    updateProfile(db, { setupCompletedAt: Date.now() });

    const categoriesBefore = countCategories(db);
    const walkCategories = (nodes: SeedCategoryNode[], parentId: string | null): void => {
      for (const node of nodes) {
        const created = createCategory(db, {
          name: node.name,
          parentId,
          description: node.description ?? null,
        });
        walkCategories(node.children ?? [], created.id);
      }
    };
    walkCategories(fixture.categories, null);
    report.categoriesCreated = countCategories(db) - categoriesBefore;

    const tagsBefore = countTags(db);
    for (const name of fixture.tags) {
      createTag(db, { name });
    }
    report.tagsCreated = countTags(db) - tagsBefore;

    for (const entry of fixture.bookmarks) {
      const categoryId = resolveCategoryPath(db, entry.categoryPath);
      const { bookmark, created } = upsertBookmarkByUrl(db, {
        url: entry.url,
        title: entry.title,
        description: entry.description,
        metadata: entry.metadata,
        categoryId,
      });
      if (created) {
        report.bookmarksAdded += 1;
        // Seed fixtures carry historical dates; set them after insert because
        // the timestamp trigger forces created_at to server time on INSERT.
        db.query('UPDATE bookmarks SET created_at = ? WHERE id = ?').run(
          entry.createdAt,
          uuidToBytes(bookmark.id),
        );
      } else {
        report.bookmarksUpdated += 1;
      }

      for (const tagName of entry.tags) {
        const tag = getTagByName(db, tagName);
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
  // Minimal default entry: the canonical octocat fixture, wiped and reloaded.
  // The db:seed script layer adds fixture selection / env handling later.
  const db = openDatabase();
  setupDatabase(db);
  const fixture = loadSeedFixture();
  const report = seedDatabase(db, fixture);
  checkpoint(db);
  console.log(`Seeded database from ${OCTOCAT_SEED_PATH}`);
  console.log(JSON.stringify(report, null, 2));
}
