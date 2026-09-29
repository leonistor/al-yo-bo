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
  listBookmarks,
  openDatabase,
  seedFromFile,
  setupDatabase,
  updateBookmark,
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
});
