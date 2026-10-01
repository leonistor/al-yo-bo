import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import { bytesToUuid, newIdBytes } from '@al-yo-bo/shared';

import {
  assignTag,
  createBookmark,
  createCategory,
  createTag,
  deleteBookmark,
  deleteCategory,
  getAggregates,
  getBookmarkById,
  getBookmarkTags,
  getCategoryById,
  keywordSearch,
  listBookmarkIdsMissingContent,
  listBookmarkIdsMissingEmbeddings,
  listBookmarks,
  listEmbeddingModelMismatches,
  openDatabase,
  resetSeedData,
  resolveSeedDataset,
  seedFromFile,
  setupDatabase,
  UnknownSeedDatasetError,
  updateBookmark,
  upsertEmbedding,
} from '../src/index.ts';

function freshDb(): Database {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  return db;
}

describe('schema & triggers', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('forces server timestamps on insert, overriding client values', () => {
    const id = newIdBytes();
    db.query('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)').run(id, 'x', 1);
    const category = getCategoryById(db, bytesToUuid(id));
    expect(category).not.toBeNull();
    expect(category?.createdAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('keeps the FTS index in sync across insert, update and delete', () => {
    const bookmark = createBookmark(db, { url: 'https://example.com/a', title: 'Hello world' });
    expect(keywordSearch(db, { q: 'hello' }).length).toBe(1);

    updateBookmark(db, bookmark.id, { title: 'Goodbye moon' });
    expect(keywordSearch(db, { q: 'hello' }).length).toBe(0);
    expect(keywordSearch(db, { q: 'moon' }).length).toBe(1);

    deleteBookmark(db, bookmark.id);
    expect(keywordSearch(db, { q: 'moon' }).length).toBe(0);
  });

  test('deleting a category nulls the bookmark reference instead of cascading', () => {
    const category = createCategory(db, { name: 'Alpha' });
    const bookmark = createBookmark(db, { url: 'https://example.com/b', categoryId: category.id });
    deleteCategory(db, category.id);
    expect(getBookmarkById(db, bookmark.id)?.categoryId).toBeNull();
  });

  test('applies the bookmark status migration with defaults', () => {
    const versions = db
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version);
    expect(versions).toContain('0002_bookmark_status.sql');

    const bookmark = createBookmark(db, { url: 'https://example.com/status-defaults' });
    expect(bookmark.status).toBe('active');
    expect(bookmark.scrapeAttempts).toBe(0);
  });
});

describe('bookmark status', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  function createStatusFixtures(): void {
    createBookmark(db, { url: 'https://s-active.test', title: 'keep me' });
    createBookmark(db, {
      url: 'https://s-invalid.test',
      title: 'keep me too',
      status: 'invalid',
      scrapeAttempts: 3,
    });
  }

  test('listBookmarks treats undefined status as unfiltered and honors explicit statuses', () => {
    createStatusFixtures();

    expect(listBookmarks(db).total).toBe(2);
    expect(listBookmarks(db, { status: 'active' }).total).toBe(1);
    expect(listBookmarks(db, { status: 'active' }).items[0]?.url).toBe('https://s-active.test/');
    expect(listBookmarks(db, { status: 'invalid' }).items[0]?.url).toBe('https://s-invalid.test/');
    expect(listBookmarks(db, { status: 'all' }).total).toBe(2);
  });

  test('keywordSearch excludes invalid bookmarks when filtered to active', () => {
    createStatusFixtures();

    expect(keywordSearch(db, { q: 'keep', status: 'active' }).length).toBe(1);
    expect(keywordSearch(db, { q: 'keep', status: 'all' }).length).toBe(2);
  });

  test('reconciliation queries exclude invalid bookmarks', () => {
    const active = createBookmark(db, { url: 'https://r-active.test', content: 'body' });
    const invalid = createBookmark(db, {
      url: 'https://r-invalid.test',
      content: 'body',
      status: 'invalid',
      scrapeAttempts: 3,
    });

    expect(listBookmarkIdsMissingContent(db)).toEqual([active.id]);
    expect(listBookmarkIdsMissingEmbeddings(db)).toEqual([active.id]);

    upsertEmbedding(db, {
      bookmarkId: active.id,
      model: 'stale-model',
      dims: 1,
      embedding: new Uint8Array([0, 0, 0, 0]),
    });
    upsertEmbedding(db, {
      bookmarkId: invalid.id,
      model: 'stale-model',
      dims: 1,
      embedding: new Uint8Array([0, 0, 0, 0]),
    });
    expect(listEmbeddingModelMismatches(db, 'current-model')).toEqual([active.id]);
  });

  test('aggregates report the invalid bookmark count', () => {
    createStatusFixtures();

    const aggregates = getAggregates(db);
    expect(aggregates.total).toBe(2);
    expect(aggregates.invalidCount).toBe(1);
  });
});

describe('tag assignments', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('classifier assignments never overwrite user assignments', () => {
    const bookmark = createBookmark(db, { url: 'https://example.com/c' });
    const tag = createTag(db, { name: 'frontend' });

    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'classifier', confidence: 0.9 });

    const [assignment] = getBookmarkTags(db, bookmark.id);
    expect(assignment?.source).toBe('user');
  });

  test('classifier assignments do update classifier-sourced rows', () => {
    const bookmark = createBookmark(db, { url: 'https://example.com/d' });
    const tag = createTag(db, { name: 'backend' });

    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'classifier', confidence: 0.5 });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'classifier', confidence: 0.8 });

    const [assignment] = getBookmarkTags(db, bookmark.id);
    expect(assignment?.confidence).toBe(0.8);
  });
});

describe('listing & aggregates', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('filters by category and paginates', () => {
    const category = createCategory(db, { name: 'Tools' });
    createBookmark(db, { url: 'https://a.test', title: 'A', categoryId: category.id });
    createBookmark(db, { url: 'https://b.test', title: 'B', categoryId: category.id });
    createBookmark(db, { url: 'https://c.test', title: 'C' });

    const page = listBookmarks(db, { categoryId: category.id, limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items.length).toBe(1);

    const aggregates = getAggregates(db);
    expect(aggregates.total).toBe(3);
    expect(aggregates.categories.find((c) => c.id === category.id)?.count).toBe(2);
  });
});

describe('seed fixture', () => {
  test('loads the synthetic demo dataset and is idempotent', () => {
    const db = freshDb();

    const first = seedFromFile(db);
    expect(first.bookmarksAdded).toBe(26);
    expect(first.categoriesCreated).toBe(8);
    expect(first.tagsCreated).toBe(51);
    expect(first.assignments).toBeGreaterThan(0);

    const second = seedFromFile(db);
    expect(second.bookmarksAdded).toBe(0);
    expect(second.bookmarksUpdated).toBe(26);
    expect(second.categoriesCreated).toBe(0);
    expect(second.tagsCreated).toBe(0);

    const aggregates = getAggregates(db);
    expect(aggregates.total).toBe(26);
    expect(keywordSearch(db, { q: 'sqlite' }).length).toBeGreaterThan(0);
  });

  test('resolves the grimoire dataset path by default and by name', () => {
    expect(resolveSeedDataset('grimoire')).toContain('seeds/datasets/grimoire.seed.json');
  });

  test('rejects unknown dataset names with the available list', () => {
    expect(() => resolveSeedDataset('nope')).toThrow(UnknownSeedDatasetError);
    expect(() => resolveSeedDataset('nope')).toThrow(/Available datasets: grimoire, leo \(not yet implemented\)/);
  });

  test('refuses reserved but unimplemented datasets', () => {
    expect(() => resolveSeedDataset('leo')).toThrow(/not implemented yet/);
  });

  test('reset wipes content so a re-seed starts clean', () => {
    const db = freshDb();

    seedFromFile(db);
    expect(getAggregates(db).total).toBe(26);

    // A stale bookmark outside the dataset proves the reset, not the upsert,
    // produced the post-reset state.
    const stray = createBookmark(db, { url: 'https://stray.example/only', title: 'Stray' });
    expect(getAggregates(db).total).toBe(27);

    resetSeedData(db);
    expect(getAggregates(db).total).toBe(0);
    expect(getBookmarkById(db, stray.id)).toBeNull();
    // The FTS delete trigger must have fired for the wiped rows too.
    expect(keywordSearch(db, { q: 'Stray' })).toHaveLength(0);

    const report = seedFromFile(db);
    expect(report.bookmarksAdded).toBe(26);
    expect(report.bookmarksUpdated).toBe(0);
    expect(getAggregates(db).total).toBe(26);
    expect(keywordSearch(db, { q: 'sqlite' }).length).toBeGreaterThan(0);
  });
});
