import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import { bytesToUuid, uuidToBytes } from '@al-yo-bo/shared';

import {
  assignTag,
  countBookmarks,
  createBookmark,
  createCategory,
  createClassificationRun,
  createTag,
  deleteBookmark,
  deleteCategory,
  candidatesForBookmark,
  CategoryCycleError,
  InvalidVocabularyNameError,
  getAggregates,
  getBookmarkById,
  getBookmarkCategoryIds,
  getBookmarkStatuses,
  getBookmarksWithTagsByIds,
  getBookmarkTags,
  getCategoryById,
  getCategorySubtreeInfo,
  getCategoryTree,
  getProfile,
  getTagByName,
  keywordSearch,
  listActiveTags,
  listBookmarkIdsMissingContent,
  listBookmarkIdsMissingEmbeddings,
  listBookmarks,
  listBookmarksForExport,
  listCategoryPath,
  listCategorySubtreeIds,
  listEmbeddingModelMismatches,
  listTags,
  loadSeedFixture,
  moveCategory,
  newIdBytes,
  OCTOCAT_SEED_PATH,
  openDatabase,
  reconcileClassifierAssignments,
  seedDatabase,
  setTagStatus,
  setupDatabase,
  updateBookmark,
  updateProfile,
  upsertBookmarkByUrl,
  upsertEmbedding,
  wipeContent,
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

  test('migration 0001 creates the v2 tables and indexes on a fresh database', () => {
    const applied = db
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version);
    expect(applied).toEqual(['0001_init.sql']);

    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    for (const name of [
      'profile',
      'categories',
      'bookmarks',
      'tags',
      'classification_runs',
      'bookmark_tags',
      'bookmark_embeddings',
      'bookmark_fts',
    ]) {
      expect(tables).toContain(name);
    }
    // Dropped evidence tables stay out of the regenerated schema.
    expect(tables).not.toContain('classification_results');
    expect(tables).not.toContain('unknown_classification_labels');

    // The v2 no-scoping indexes exist; no dataset/section artifacts remain.
    const indexes = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    for (const name of [
      'bookmarks_url_unique',
      'categories_root_name_unique',
      'categories_child_name_unique',
      'categories_parent_order',
      'tags_name_unique',
    ]) {
      expect(indexes).toContain(name);
    }
    expect(tables).not.toContain('datasets');
    expect(tables).not.toContain('sections');
  });

  test('the profile singleton exists with the sentinel id and null identity', () => {
    const profile = getProfile(db)!;
    expect(profile.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(profile.name).toBeNull();
    expect(profile.githubUsername).toBeNull();
    expect(profile.avatarPath).toBeNull();
    expect(profile.devProfile).toBeNull();
    expect(profile.setupCompletedAt).toBeNull();
    expect(profile.createdAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('forces server timestamps on insert, overriding client values', () => {
    const id = newIdBytes();
    db.query('INSERT INTO categories (id, sort_order, name, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      'U',
      'x',
      1,
    );
    const category = getCategoryById(db, bytesToUuid(id));
    expect(category).not.toBeNull();
    expect(category?.createdAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('bumps bookmark_embeddings.updated_at on re-upsert', () => {
    const bookmark = createBookmark(db, {
      url: 'https://example.com/embed-fresh',
      content: 'body',
    });
    upsertEmbedding(db, {
      bookmarkId: bookmark.id,
      model: 'model-a',
      dims: 1,
      embedding: new Uint8Array([0, 0, 0, 0]),
    });
    // Force a naive timestamp so the re-upsert bump is observable without sleeping.
    db.query('UPDATE bookmark_embeddings SET updated_at = 1 WHERE bookmark_id = ?').run(
      uuidToBytes(bookmark.id),
    );

    upsertEmbedding(db, {
      bookmarkId: bookmark.id,
      model: 'model-b',
      dims: 1,
      embedding: new Uint8Array([1, 1, 1, 1]),
    });

    const row = db
      .query<{ updated_at: number; model: string }, [Uint8Array]>(
        'SELECT updated_at, model FROM bookmark_embeddings WHERE bookmark_id = ?',
      )
      .get(uuidToBytes(bookmark.id));
    expect(row?.model).toBe('model-b');
    expect(row?.updated_at).toBeGreaterThan(1_000_000_000_000);
  });

  test('keeps the FTS index in sync across insert, update and delete', () => {
    const bookmark = createBookmark(db, {
      url: 'https://example.com/a',
      title: 'Hello world',
    });
    expect(keywordSearch(db, { q: 'hello' }).length).toBe(1);

    updateBookmark(db, bookmark.id, { title: 'Goodbye moon' });
    expect(keywordSearch(db, { q: 'hello' }).length).toBe(0);
    expect(keywordSearch(db, { q: 'moon' }).length).toBe(1);

    deleteBookmark(db, bookmark.id);
    expect(keywordSearch(db, { q: 'moon' }).length).toBe(0);
  });

  test('enforces global URL uniqueness', () => {
    createBookmark(db, { url: 'https://dup.test/page' });
    expect(() => createBookmark(db, { url: 'https://dup.test/page' })).toThrow();
    // The upsert key is the same global URL: a second upsert merges in place.
    const merged = upsertBookmarkByUrl(db, { url: 'https://dup.test/page', title: 'merged' });
    expect(merged.created).toBe(false);
    expect(countBookmarks(db)).toBe(1);
    expect(merged.bookmark.title).toBe('merged');
  });

  test('enforces global tag-name uniqueness', () => {
    const tag = createTag(db, { name: 'web' });
    const again = createTag(db, { name: 'web' });
    expect(again.id).toBe(tag.id);
    expect(listTags(db)).toHaveLength(1);
    // A raw duplicate insert violates tags_name_unique.
    expect(() =>
      db
        .query('INSERT INTO tags (id, name, status) VALUES (?, ?, ?)')
        .run(newIdBytes(), 'web', 'active'),
    ).toThrow();
  });

  test('sibling names are unique per parent, but reusable across parents and at the root', () => {
    const web = createCategory(db, { name: 'web' });
    const books = createCategory(db, { name: 'books' });
    createCategory(db, { name: '2024', parentId: web.id });
    // Same name under a different parent is allowed (two partial indexes).
    createCategory(db, { name: '2024', parentId: books.id });
    // Same name as a root while children hold it is allowed too.
    createCategory(db, { name: '2024' });
    expect(getCategoryById(db, books.id)).not.toBeNull();

    // Same name under the SAME parent: the helper merges (returns the
    // existing sibling — importer semantics), and a raw insert that bypasses
    // the merge hits the partial unique index.
    const merged = createCategory(db, { name: '2024', parentId: web.id, sortOrder: 'zz' });
    expect(merged.sortOrder).not.toBe('zz');
    expect(() =>
      db
        .query('INSERT INTO categories (id, parent_id, sort_order, name) VALUES (?, ?, ?, ?)')
        .run(newIdBytes(), uuidToBytes(books.id), 'm', '2024'),
    ).toThrow();
  });

  test('createCategory and createTag reject blank/whitespace names', () => {
    // Regression: importer `##  ` headings used to reach the row, and dedupe
    // was case- and whitespace-sensitive. requireVocabularyName trims and
    // rejects empty at the db boundary so both HTTP and importer paths agree.
    expect(() => createCategory(db, { name: '' })).toThrow(InvalidVocabularyNameError);
    expect(() => createCategory(db, { name: '   ' })).toThrow(InvalidVocabularyNameError);
    expect(() => createTag(db, { name: '' })).toThrow(InvalidVocabularyNameError);
    expect(() => createTag(db, { name: '\t\n' })).toThrow(InvalidVocabularyNameError);
  });

  test('createCategory and createTag trim surrounding whitespace', () => {
    // The trim is intentional: it makes the dedupe scope honest (Dev vs Dev ).
    const trimmed = createCategory(db, { name: '  Dev  ' });
    expect(trimmed.name).toBe('Dev');
    // A subsequent "Dev" merges instead of becoming a duplicate row.
    const merged = createCategory(db, { name: 'Dev' });
    expect(merged.id).toBe(trimmed.id);

    const tag = createTag(db, { name: ' rust ' });
    expect(tag.name).toBe('rust');
  });
});

describe('category tree', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('createCategory appends fractional sort keys per sibling list', () => {
    const root = createCategory(db, { name: 'root' });
    const a = createCategory(db, { name: 'a', parentId: root.id });
    const b = createCategory(db, { name: 'b', parentId: root.id });
    const c = createCategory(db, { name: 'c', parentId: root.id });
    expect(a.sortOrder < b.sortOrder && b.sortOrder < c.sortOrder).toBe(true);
    // Roots get their own independent key sequence.
    const other = createCategory(db, { name: 'other-root' });
    expect(other.sortOrder >= root.sortOrder).toBe(true);
  });

  test('getCategoryTree nests children under roots in sort order', () => {
    const dev = createCategory(db, { name: 'dev' });
    createCategory(db, { name: 'editors', parentId: dev.id });
    createCategory(db, { name: 'web', parentId: dev.id });
    const design = createCategory(db, { name: 'design' });
    expect(design.parentId).toBeNull();

    const tree = getCategoryTree(db);
    expect(tree.map((node) => node.name)).toEqual(['dev', 'design']);
    expect(tree[0]!.children.map((node) => node.name)).toEqual(['editors', 'web']);
    expect(tree[0]!.children[0]!.children).toEqual([]);
    expect(tree[1]!.name).toBe('design');
  });

  test('listCategoryPath returns the ancestor chain root → node', () => {
    const root = createCategory(db, { name: 'dev' });
    const mid = createCategory(db, { name: 'web', parentId: root.id });
    const leaf = createCategory(db, { name: '2024', parentId: mid.id });
    expect(listCategoryPath(db, leaf.id).map((c) => c.name)).toEqual(['dev', 'web', '2024']);
    expect(listCategoryPath(db, root.id).map((c) => c.name)).toEqual(['dev']);
  });

  test('listCategorySubtreeIds returns the root and every descendant, nothing else', () => {
    const root = createCategory(db, { name: 'dev' });
    const mid = createCategory(db, { name: 'web', parentId: root.id });
    const leaf = createCategory(db, { name: '2024', parentId: mid.id });
    createCategory(db, { name: 'unrelated' });

    expect(listCategorySubtreeIds(db, root.id).toSorted()).toEqual(
      [root.id, mid.id, leaf.id].toSorted(),
    );
    expect(listCategorySubtreeIds(db, leaf.id)).toEqual([leaf.id]);
  });

  test('moveCategory re-parents with a fresh sibling key', () => {
    const parentA = createCategory(db, { name: 'a' });
    const parentB = createCategory(db, { name: 'b' });
    const child = createCategory(db, { name: 'child', parentId: parentA.id });

    const moved = moveCategory(db, child.id, parentB.id);
    expect(moved?.parentId).toBe(parentB.id);
    expect(getCategoryTree(db).find((n) => n.id === parentB.id)?.children[0]?.id).toBe(child.id);
  });

  test('moveCategory refuses self-parenting and descendant targets', () => {
    const root = createCategory(db, { name: 'root' });
    const child = createCategory(db, { name: 'child', parentId: root.id });
    const grandchild = createCategory(db, { name: 'grandchild', parentId: child.id });

    expect(() => moveCategory(db, root.id, root.id)).toThrow(CategoryCycleError);
    // Moving root under its own grandchild would close a cycle.
    expect(() => moveCategory(db, root.id, grandchild.id)).toThrow(CategoryCycleError);
    expect(() => moveCategory(db, child.id, child.id)).toThrow(CategoryCycleError);
    // Legitimate move still works after the refusals.
    expect(moveCategory(db, grandchild.id, null)?.parentId).toBeNull();
  });

  test('deleteCategory cascades the subtree and nulls bookmark references', () => {
    const root = createCategory(db, { name: 'root' });
    const child = createCategory(db, { name: 'child', parentId: root.id });
    const inChild = createBookmark(db, { url: 'https://tree.test/child', categoryId: child.id });
    const elsewhere = createBookmark(db, { url: 'https://tree.test/elsewhere' });

    expect(getCategorySubtreeInfo(db, root.id)).toEqual({ categories: 2, bookmarks: 1 });
    const info = deleteCategory(db, root.id);
    expect(info).toEqual({ categories: 2, bookmarks: 1 });

    expect(getCategoryById(db, root.id)).toBeNull();
    expect(getCategoryById(db, child.id)).toBeNull();
    // Bookmarks are content, not structure: they survive with a NULL category.
    expect(getBookmarkById(db, inChild.id)?.categoryId).toBeNull();
    expect(getBookmarkById(db, elsewhere.id)).not.toBeNull();
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

  test('getBookmarkStatuses batches id → status lookups', () => {
    const active = createBookmark(db, { url: 'https://bs-active.test' });
    const invalid = createBookmark(db, {
      url: 'https://bs-invalid.test',
      status: 'invalid',
      scrapeAttempts: 3,
    });
    const unknown = '00000000-0000-0000-0000-000000000000';

    const statuses = getBookmarkStatuses(db, [active.id, invalid.id, unknown]);
    expect(statuses.get(active.id)).toBe('active');
    expect(statuses.get(invalid.id)).toBe('invalid');
    expect(statuses.has(unknown)).toBe(false);
    expect(getBookmarkStatuses(db, []).size).toBe(0);
  });

  test('getBookmarkCategoryIds batches id → category lookups with null for uncategorized', () => {
    const category = createCategory(db, { name: 'shelved' });
    const categorized = createBookmark(db, {
      url: 'https://bc-categorized.test',
      categoryId: category.id,
    });
    const plain = createBookmark(db, { url: 'https://bc-plain.test' });
    const unknown = '00000000-0000-0000-0000-000000000000';

    const categories = getBookmarkCategoryIds(db, [categorized.id, plain.id, unknown]);
    expect(categories.get(categorized.id)).toBe(category.id);
    expect(categories.get(plain.id)).toBeNull();
    expect(categories.has(unknown)).toBe(false);
    expect(getBookmarkCategoryIds(db, []).size).toBe(0);
  });

  test('IN-list lookups chunk past SQLite host-parameter limits', () => {
    // 1200 ids exceeds SQLite's default host-parameter limit (999), so an
    // unchunked IN (...) would throw "too many SQL variables".
    const ids: string[] = [];
    db.transaction(() => {
      const insert = db.query('INSERT INTO bookmarks (id, url, title, status) VALUES (?, ?, ?, ?)');
      for (let i = 0; i < 1200; i++) {
        const id = newIdBytes();
        insert.run(id, `https://chunk.test/${i}`, `Chunk ${i}`, 'active');
        ids.push(bytesToUuid(id));
      }
    }).immediate();

    const unknown = '00000000-0000-0000-0000-000000000000';
    const statuses = getBookmarkStatuses(db, [...ids, unknown]);
    expect(statuses.size).toBe(1200);
    expect(statuses.get(ids[0]!)).toBe('active');
    expect(statuses.has(unknown)).toBe(false);

    const hydrated = getBookmarksWithTagsByIds(db, ids);
    expect(hydrated).toHaveLength(1200);
    expect(hydrated[0]!.id).toBe(ids[0]!);
    expect(hydrated[1199]!.id).toBe(ids[1199]!);
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
    assignTag(db, {
      bookmarkId: bookmark.id,
      tagId: tag.id,
      source: 'classifier',
      confidence: 0.9,
    });

    const [assignment] = getBookmarkTags(db, bookmark.id);
    expect(assignment?.source).toBe('user');
  });

  test('classifier assignments do update classifier-sourced rows', () => {
    const bookmark = createBookmark(db, { url: 'https://example.com/d' });
    const tag = createTag(db, { name: 'backend' });

    assignTag(db, {
      bookmarkId: bookmark.id,
      tagId: tag.id,
      source: 'classifier',
      confidence: 0.5,
    });
    assignTag(db, {
      bookmarkId: bookmark.id,
      tagId: tag.id,
      source: 'classifier',
      confidence: 0.8,
    });

    const [assignment] = getBookmarkTags(db, bookmark.id);
    expect(assignment?.confidence).toBe(0.8);
  });
});

describe('classification candidate set', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('candidates are ALL active tags regardless of category (MODEL.md principle 2)', () => {
    const category = createCategory(db, { name: 'scoped' });
    const bookmark = createBookmark(db, { url: 'https://cand.test', categoryId: category.id });
    createTag(db, { name: 'active-one' });
    createTag(db, { name: 'active-two' });
    const retired = createTag(db, { name: 'retired' });

    // The bookmark's category must not narrow the set: tags have no category.
    expect(candidatesForBookmark(db, bookmark.id).map((tag) => tag.name)).toEqual([
      'active-one',
      'active-two',
      'retired',
    ]);

    // Deprecating removes a tag from the candidate set; the row stays for history.
    setTagStatus(db, retired.id, 'deprecated');
    expect(candidatesForBookmark(db, bookmark.id).map((tag) => tag.name)).toEqual([
      'active-one',
      'active-two',
    ]);
    expect(listActiveTags(db)).toHaveLength(2);
  });
});

describe('classifier retraction', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  function seedTagsAndBookmark(): { bookmark: ReturnType<typeof createBookmark>; keep: ReturnType<typeof createTag>; drop: ReturnType<typeof createTag> } {
    const bookmark = createBookmark(db, { url: 'https://retract.test' });
    const keep = createTag(db, { name: 'keep' });
    const drop = createTag(db, { name: 'drop' });
    return { bookmark, keep, drop };
  }

  test('deletes stale classifier-sourced bookmark_tags rows', () => {
    const { bookmark, keep, drop } = seedTagsAndBookmark();

    assignTag(db, { bookmarkId: bookmark.id, tagId: keep.id, source: 'classifier', confidence: 0.9 });
    assignTag(db, { bookmarkId: bookmark.id, tagId: drop.id, source: 'classifier', confidence: 0.9 });

    const { retracted } = reconcileClassifierAssignments(db, {
      bookmarkId: bookmark.id,
      qualifiedTagIds: [keep.id],
    });

    expect(retracted).toBe(1);
    expect(getBookmarkTags(db, bookmark.id).map((t) => t.name)).toEqual(['keep']);
  });

  test('leaves user and import rows untouched', () => {
    const { bookmark, keep, drop } = seedTagsAndBookmark();

    assignTag(db, { bookmarkId: bookmark.id, tagId: keep.id, source: 'import' });
    assignTag(db, { bookmarkId: bookmark.id, tagId: drop.id, source: 'user' });

    const { retracted } = reconcileClassifierAssignments(db, {
      bookmarkId: bookmark.id,
      qualifiedTagIds: [],
    });

    expect(retracted).toBe(0);
    const names = getBookmarkTags(db, bookmark.id).map((t) => t.name).toSorted();
    expect(names).toEqual(['drop', 'keep']);
  });

  test('deletes all classifier rows when qualifiedTagIds is empty', () => {
    const { bookmark, keep, drop } = seedTagsAndBookmark();

    assignTag(db, { bookmarkId: bookmark.id, tagId: keep.id, source: 'classifier', confidence: 0.9 });
    assignTag(db, { bookmarkId: bookmark.id, tagId: drop.id, source: 'classifier', confidence: 0.9 });

    const { retracted } = reconcileClassifierAssignments(db, {
      bookmarkId: bookmark.id,
      qualifiedTagIds: [],
    });

    expect(retracted).toBe(2);
    expect(getBookmarkTags(db, bookmark.id)).toEqual([]);
  });

  test('user/import rows win when a classifier row overlaps', () => {
    const { bookmark, keep } = seedTagsAndBookmark();

    assignTag(db, { bookmarkId: bookmark.id, tagId: keep.id, source: 'user' });
    // The classifier also thought it qualified, but the user row already won.
    assignTag(db, { bookmarkId: bookmark.id, tagId: keep.id, source: 'classifier', confidence: 0.9 });

    const { retracted } = reconcileClassifierAssignments(db, {
      bookmarkId: bookmark.id,
      qualifiedTagIds: [],
    });

    expect(retracted).toBe(0);
    const [assignment] = getBookmarkTags(db, bookmark.id);
    expect(assignment?.source).toBe('user');
  });
});

describe('profile setup fields', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('round-trips devProfile JSON and setupCompletedAt', () => {
    const devProfile = {
      source: 'wizard',
      focus: 'web',
      languages: ['typescript', 'rust'],
      frameworks: ['react'],
      tools: ['neovim'],
      experience: 'senior',
      notes: 'hello',
    };

    const updated = updateProfile(db, { devProfile, setupCompletedAt: 42_000 });
    expect(updated?.devProfile).toEqual(devProfile);
    expect(updated?.setupCompletedAt).toBe(42_000);

    const reloaded = getProfile(db);
    expect(reloaded?.devProfile).toEqual(devProfile);
    expect(reloaded?.setupCompletedAt).toBe(42_000);
  });

  test('devProfile null clears stored JSON', () => {
    updateProfile(db, {
      devProfile: { source: 'wizard', focus: 'web' },
      setupCompletedAt: 1,
    });
    const cleared = updateProfile(db, { devProfile: null });
    expect(cleared?.devProfile).toBeNull();
    expect(cleared?.setupCompletedAt).toBe(1);
  });

  test('malformed stored dev_profile parses as null', () => {
    db.query('UPDATE profile SET dev_profile = ? WHERE id = ?').run(
      'not-json',
      uuidToBytes('00000000-0000-0000-0000-000000000000'),
    );
    expect(getProfile(db)?.devProfile).toBeNull();
  });
});

describe('listing & aggregates', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('a category filter matches the whole subtree, paginates, and aggregates per category', () => {
    const parent = createCategory(db, { name: 'Tools' });
    const child = createCategory(db, { name: 'Hammer', parentId: parent.id });
    createBookmark(db, { url: 'https://a.test', title: 'A', categoryId: parent.id });
    createBookmark(db, { url: 'https://b.test', title: 'B', categoryId: child.id });
    createBookmark(db, { url: 'https://c.test', title: 'C' });

    // MODEL.md principle 2: a bookmark in a child category matches a
    // parent-category filter — the filter expands to the subtree.
    expect(listBookmarks(db, { categoryId: parent.id }).total).toBe(2);
    expect(listBookmarks(db, { categoryId: child.id }).total).toBe(1);
    expect(listBookmarks(db).total).toBe(3);

    const page = listBookmarks(db, { categoryId: parent.id, limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items.length).toBe(1);

    const aggregates = getAggregates(db);
    expect(aggregates.total).toBe(3);
    const byId = new Map(aggregates.categories.map((c) => [c.id, c]));
    expect(byId.get(parent.id)?.count).toBe(1);
    expect(byId.get(child.id)?.count).toBe(1);
    expect(byId.get(parent.id)?.parentId).toBeNull();
    expect(byId.get(child.id)?.parentId).toBe(parent.id);
  });

  test('keyword search honors the subtree filter too', () => {
    const parent = createCategory(db, { name: 'Lang' });
    const child = createCategory(db, { name: 'Rust', parentId: parent.id });
    createBookmark(db, {
      url: 'https://rust.test',
      title: 'Rust async guide',
      categoryId: child.id,
    });
    createBookmark(db, { url: 'https://go.test', title: 'Go async guide' });

    expect(keywordSearch(db, { q: 'async', categoryId: parent.id })).toHaveLength(1);
    expect(keywordSearch(db, { q: 'async' })).toHaveLength(2);
  });

  test('deleting a bookmark removes its tags and FTS rows with it', () => {
    const bookmark = createBookmark(db, { url: 'https://del.test', title: 'Doomed' });
    const tag = createTag(db, { name: 'doomed-tag' });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });
    expect(keywordSearch(db, { q: 'doomed' })).toHaveLength(1);

    deleteBookmark(db, bookmark.id);
    expect(keywordSearch(db, { q: 'doomed' })).toHaveLength(0);
    expect(getBookmarkTags(db, bookmark.id)).toEqual([]);
    // The tag itself is vocabulary — it survives the bookmark.
    expect(getTagByName(db, 'doomed-tag')).not.toBeNull();
  });
});

describe('export listing', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('filters by an inclusive created_at range', () => {
    const older = createBookmark(db, { url: 'https://exp-old.test' });
    const middle = createBookmark(db, { url: 'https://exp-mid.test' });
    const newer = createBookmark(db, { url: 'https://exp-new.test' });
    for (const [bookmark, at] of [
      [older, 1000],
      [middle, 2000],
      [newer, 3000],
    ] as const) {
      db.query('UPDATE bookmarks SET created_at = ? WHERE id = ?').run(
        at,
        uuidToBytes(bookmark.id),
      );
    }

    const rows = listBookmarksForExport(db, { dateFrom: 1000, dateTo: 2000 });
    expect(rows.map((bookmark) => bookmark.id)).toEqual([middle.id, older.id]);
  });

  test('combines category, tag, and status filters', () => {
    const category = createCategory(db, { name: 'Exportable' });
    const tag = createTag(db, { name: 'export-tag' });
    const match = createBookmark(db, { url: 'https://exp-match.test', categoryId: category.id });
    assignTag(db, { bookmarkId: match.id, tagId: tag.id, source: 'user' });
    createBookmark(db, { url: 'https://exp-other.test', categoryId: category.id });
    createBookmark(db, {
      url: 'https://exp-invalid.test',
      categoryId: category.id,
      status: 'invalid',
      scrapeAttempts: 3,
    });

    const rows = listBookmarksForExport(db, {
      categoryId: category.id,
      tagId: tag.id,
      status: 'active',
    });
    expect(rows.map((bookmark) => bookmark.id)).toEqual([match.id]);
  });

  test('filters by a full-text query through the FTS index', () => {
    const hit = createBookmark(db, {
      url: 'https://exp-fts.test',
      title: 'Kubernetes networking guide',
    });
    createBookmark(db, { url: 'https://exp-fts-other.test', title: 'Gardening tips' });

    const rows = listBookmarksForExport(db, { q: 'kubernetes' });
    expect(rows.map((bookmark) => bookmark.id)).toEqual([hit.id]);
  });

  test('returns the whole filtered set, bypassing the list page cap', () => {
    db.transaction(() => {
      const insert = db.query('INSERT INTO bookmarks (id, url, title, status) VALUES (?, ?, ?, ?)');
      for (let i = 0; i < 105; i++) {
        insert.run(newIdBytes(), `https://exp-bulk.test/${i}`, `Bulk ${i}`, 'active');
      }
    }).immediate();

    expect(listBookmarks(db, { limit: 100 }).items).toHaveLength(100);
    expect(listBookmarksForExport(db)).toHaveLength(105);
  });

  test('orders by created_at desc with id as a stable tie-break', () => {
    const ids: string[] = [];
    db.transaction(() => {
      const insert = db.query('INSERT INTO bookmarks (id, url, title, status) VALUES (?, ?, ?, ?)');
      for (let i = 0; i < 10; i++) {
        const id = newIdBytes();
        insert.run(id, `https://exp-order.test/${i}`, `Order ${i}`, 'active');
        ids.push(bytesToUuid(id));
      }
    }).immediate();
    db.query('UPDATE bookmarks SET created_at = 5000').run();

    const rows = listBookmarksForExport(db);
    expect(rows.map((bookmark) => bookmark.id)).toEqual(ids.toSorted());
  });
});

describe('bookmark image projection', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  // Regression: the UI's screenshot -> og:image -> placeholder chain reads
  // `bookmark.image`, so every hydrated read path must project metadata.image.
  test('projects metadata.image onto list and by-ids reads', () => {
    const image = {
      ogImageUrl: 'https://img.test/og.png',
      screenshotPath: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa.jpg',
    };
    const created = createBookmark(db, {
      url: 'https://img.test',
      title: 'With image',
      metadata: { image },
    });

    expect(listBookmarks(db).items[0]?.image).toEqual(image);
    expect(getBookmarksWithTagsByIds(db, [created.id])[0]?.image).toEqual(image);
  });

  test('falls back to a both-null image when metadata has none', () => {
    createBookmark(db, { url: 'https://plain.test' });
    expect(listBookmarks(db).items[0]?.image).toEqual({ ogImageUrl: null, screenshotPath: null });
  });
});

describe('keyword search snippets', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('a content-only match returns a snippet drawn from content', () => {
    createBookmark(db, {
      url: 'https://example.com/content-snippet',
      title: 'Totally Unrelated Title',
      content: 'The quick brown fox jumps over the lazy dog and drinks from the river bank',
    });

    const [hit] = keywordSearch(db, { q: 'river' });
    expect(hit?.snippet).toContain('river');
    expect(hit?.snippet).toContain('[river]');
  });

  test('a title-only match falls back to the title', () => {
    createBookmark(db, { url: 'https://example.com/title-fallback', title: 'Rust async guide' });

    const [hit] = keywordSearch(db, { q: 'async' });
    expect(hit?.snippet).toBe('Rust async guide');
  });
});

describe('seed fixture', () => {
  test('loads the octocat fixture: 25 bookmarks, the tree, and the profile identity', () => {
    const db = freshDb();
    const report = seedDatabase(db, loadSeedFixture(OCTOCAT_SEED_PATH));

    expect(report.wipe).toEqual({ bookmarks: 0, tags: 0, categories: 0 });
    expect(report.bookmarksAdded).toBe(25);
    expect(report.categoriesCreated).toBe(14); // 5 roots + 9 children
    expect(report.tagsCreated).toBe(67);
    expect(report.assignments).toBe(111);

    const aggregates = getAggregates(db);
    expect(aggregates.total).toBe(25);
    expect(aggregates.categories).toHaveLength(14);

    // Tree shape: the roots land in fixture order with their children nested.
    const tree = getCategoryTree(db);
    expect(tree.map((node) => node.name)).toEqual([
      'GitHub',
      'AI tools',
      'Dev tools',
      'Learning',
      'Design',
    ]);
    const aiTools = tree[1]!;
    expect(aiTools.children.map((node) => node.name)).toEqual([
      'Models & hubs',
      'Local & self-hosted',
    ]);
    // A bookmark in an H3 child resolves through the whole path.
    const qdrant = listBookmarks(db, { q: 'qdrant' }).items[0]!;
    expect(listCategoryPath(db, qdrant.categoryId!).map((c) => c.name)).toEqual([
      'AI tools',
      'Local & self-hosted',
    ]);

    // The fixture owns the profile identity and marks setup complete.
    const profile = getProfile(db);
    expect(profile?.name).toBe('octocat');
    expect(profile?.githubUsername).toBe('octocat');
    expect(profile?.setupCompletedAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('re-seeding wipes the workspace first (ported clear semantics, FTS included)', () => {
    const db = freshDb();
    const fixture = loadSeedFixture(OCTOCAT_SEED_PATH);
    seedDatabase(db, fixture);
    expect(getAggregates(db).total).toBe(25);

    // Content seeded again starts from a clean slate: wipe counts are the
    // previous load, nothing accumulates, and the FTS index has no ghosts.
    const report = seedDatabase(db, fixture);
    expect(report.wipe).toEqual({ bookmarks: 25, tags: 67, categories: 14 });
    expect(report.bookmarksAdded).toBe(25);
    expect(report.bookmarksUpdated).toBe(0);
    expect(getAggregates(db).total).toBe(25);
    expect(keywordSearch(db, { q: 'qdrant' })).toHaveLength(1);
    expect(keywordSearch(db, { q: 'octocat' })).toHaveLength(0);
  });

  test('wipeContent removes every content row but keeps the profile and classification_runs integrity', () => {
    const db = freshDb();
    seedDatabase(db, loadSeedFixture(OCTOCAT_SEED_PATH));
    const bookmark = listBookmarks(db).items[0]!;
    const tag = createTag(db, { name: 'wipe-tag' });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });
    createClassificationRun(db, { bookmarkId: bookmark.id, classifier: 'ollaya' });
    expect(db.query('SELECT COUNT(*) AS n FROM classification_runs').get()).toEqual({ n: 1 });
    upsertEmbedding(db, {
      bookmarkId: bookmark.id,
      model: 'test-model',
      dims: 1,
      embedding: new Uint8Array([0, 0, 0, 0]),
    });

    const counts = wipeContent(db);
    expect(counts).toEqual({ bookmarks: 25, tags: 68, categories: 14 });

    // Everything content-scoped is gone, including cascaded evidence.
    expect(getAggregates(db)).toEqual({ total: 0, invalidCount: 0, categories: [], tags: [] });
    expect(keywordSearch(db, { q: 'github' })).toHaveLength(0);
    expect(db.query('SELECT COUNT(*) AS n FROM classification_runs').get()).toEqual({ n: 0 });
    expect(db.query('SELECT COUNT(*) AS n FROM bookmark_embeddings').get()).toEqual({ n: 0 });
    expect(db.query('SELECT COUNT(*) AS n FROM bookmark_tags').get()).toEqual({ n: 0 });

    // The profile is the person — never wiped (MODEL.md principle 8).
    expect(getProfile(db)?.name).toBe('octocat');
    expect(getProfile(db)?.setupCompletedAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('reset: false merges by URL instead of wiping', () => {
    const db = freshDb();
    const fixture = loadSeedFixture(OCTOCAT_SEED_PATH);
    seedDatabase(db, fixture);

    const report = seedDatabase(db, fixture, { reset: false });
    expect(report.wipe).toBeUndefined();
    expect(report.bookmarksAdded).toBe(0);
    expect(report.bookmarksUpdated).toBe(25);
    expect(report.categoriesCreated).toBe(0);
    expect(report.tagsCreated).toBe(0);
    expect(getAggregates(db).total).toBe(25);
  });
});
