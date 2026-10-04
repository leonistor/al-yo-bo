import { describe, expect, test } from 'bun:test';

import {
  assignTag,
  createBookmark,
  createCategory,
  createTag,
  getBookmarkById,
  setTagStatus,
} from '@al-yo-bo/db';

import { ConflictError, NotFoundError, ValidationError } from '../src/errors.ts';
import { createVocabularyService } from '../src/services/vocabulary.ts';
import { createVectorProvider } from '../src/vector/provider.ts';
import { StubVectorIndex, makeDb, recordingEvents, recordingJobs } from './support.ts';

function makeService(vector = new StubVectorIndex()) {
  const db = makeDb();
  const jobs = recordingJobs();
  const events = recordingEvents();
  const service = createVocabularyService({
    db,
    jobs,
    vector: createVectorProvider(vector, 'memory'),
    events,
  });
  return { db, jobs, events, vector, service };
}

describe('VocabularyService — category tree', () => {
  test('createCategory nests under its parent and rejects a missing parent', () => {
    const { service } = makeService();

    const root = service.createCategory({ name: 'Dev' });
    const child = service.createCategory({ name: 'Web', parentId: root.id });

    const tree = service.getCategoryTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe('Dev');
    expect(tree[0]!.children.map((node) => node.name)).toEqual(['Web']);
    expect(child.parentId).toBe(root.id);

    expect(() =>
      service.createCategory({ name: 'X', parentId: '11111111-1111-4111-8111-111111111111' }),
    ).toThrow(NotFoundError);
  });

  test('sibling names are unique; the same name under a different parent coexists', () => {
    const { service } = makeService();

    const dev = service.createCategory({ name: 'Dev' });
    const books = service.createCategory({ name: 'Books' });

    service.createCategory({ name: '2024', parentId: dev.id });
    // Sibling-unique, not globally unique: books/2024 may coexist (MODEL.md H3).
    expect(() => service.createCategory({ name: '2024', parentId: dev.id })).toThrow(ConflictError);
    expect(service.createCategory({ name: '2024', parentId: books.id }).name).toBe('2024');
  });

  test('rename onto an existing sibling name conflicts; own name succeeds', () => {
    const { service } = makeService();
    const a = service.createCategory({ name: 'A' });
    const b = service.createCategory({ name: 'B' });

    expect(() => service.updateCategory(b.id, { name: 'A' })).toThrow(ConflictError);
    expect(service.updateCategory(a.id, { name: 'A' }).name).toBe('A');
  });

  test('a garbage sort-order key maps to ValidationError instead of a raw db error', () => {
    const { service } = makeService();
    const stuck = service.createCategory({ name: 'Stuck' });
    const other = service.createCategory({ name: 'Other' });

    // An explicit key outside the [0-9A-Za-z] alphabet is stored as-is by the
    // db move ('~' sorts after every alnum in BINARY, so it becomes the tail);
    // the next append walks orderAfter over it and asserts (db/sort-order.ts).
    service.moveCategory(stuck.id, null, '~~');

    expect(() => service.moveCategory(other.id, null)).toThrow(ValidationError);
    expect(() => service.moveCategory(other.id, null)).toThrow(/sort-order key/);
  });

  test('moveCategory re-parents the subtree and refuses cycles', () => {
    const { service } = makeService();

    const a = service.createCategory({ name: 'A' });
    const b = service.createCategory({ name: 'B', parentId: a.id });
    const c = service.createCategory({ name: 'C', parentId: b.id });

    // A cycle: A cannot take its own descendant C as parent (app-layer rule).
    expect(() => service.moveCategory(a.id, c.id)).toThrow(ValidationError);
    expect(() => service.moveCategory(a.id, a.id)).toThrow(ValidationError);

    // Moving B to the root level detaches its whole subtree (C follows).
    service.moveCategory(b.id, null);
    const tree = service.getCategoryTree();
    expect(tree.map((node) => node.name).toSorted()).toEqual(['A', 'B']);
    const bNode = tree.find((node) => node.id === b.id)!;
    expect(bNode.children.map((node) => node.name)).toEqual(['C']);

    expect(() => service.moveCategory(c.id, '11111111-1111-4111-8111-111111111111')).toThrow(
      NotFoundError,
    );
  });

  test('moveCategory conflicts with a same-named sibling under the target parent', () => {
    const { service } = makeService();
    // Sibling names are unique per parent (web/2024 and books/2024 coexist),
    // so a clash only occurs when the TARGET parent already has a same-named
    // child.
    const dev = service.createCategory({ name: 'Dev' });
    service.createCategory({ name: 'Tools', parentId: dev.id });
    const books = service.createCategory({ name: 'Books' });
    const booksTools = service.createCategory({ name: 'Tools', parentId: books.id });

    expect(() => service.moveCategory(booksTools.id, dev.id)).toThrow(ConflictError);
  });

  test('reorderCategories persists the new sibling order with increasing fractional keys', () => {
    const { service } = makeService();

    const a = service.createCategory({ name: 'A' });
    const b = service.createCategory({ name: 'B' });
    const c = service.createCategory({ name: 'C' });

    const reordered = service.reorderCategories(null, [c.id, a.id, b.id]);
    expect(reordered.map((category) => category.name)).toEqual(['C', 'A', 'B']);

    // Keys are lexicographically increasing along the new order (BINARY collation).
    const keys = reordered.map((category) => category.sortOrder);
    expect(keys.toSorted()).toEqual(keys);

    const tree = service.getCategoryTree();
    expect(tree.map((node) => node.name)).toEqual(['C', 'A', 'B']);
  });

test('reorderCategories rejects lists that mix parents or duplicate ids', () => {
    const { service } = makeService();
    const root = service.createCategory({ name: 'Root' });
    const child = service.createCategory({ name: 'Child', parentId: root.id });

    expect(() => service.reorderCategories(null, [root.id, child.id])).toThrow(ValidationError);
    expect(() => service.reorderCategories(null, [root.id, root.id])).toThrow(ValidationError);
    expect(() => service.reorderCategories(null, [root.id, '11111111-1111-4111-8111-111111111111'])).toThrow(NotFoundError);
  });

  test('reorderCategories is atomic: a bad list leaves the prior order intact', () => {
    const { service } = makeService();
    const a = service.createCategory({ name: 'A' });
    const c = service.createCategory({ name: 'C' });

    const beforeOrder = service.getCategoryTree().map((node) => node.name);
    const beforeKeys = new Map(
      service.getCategoryTree().map((node) => [node.name, node.sortOrder]),
    );

    // The phantom id does not exist; the validation throws before any UPDATE
    // runs. The contract is "one transaction" so a future failure mode
    // (a sort-order assertion mid-loop) must also roll back; here the
    // pre-check fails first and the prior tree is untouched.
    const phantom = '11111111-1111-4111-8111-111111111111';
    expect(() => service.reorderCategories(null, [c.id, a.id, phantom])).toThrow();

    const afterTree = service.getCategoryTree();
    expect(afterTree.map((node) => node.name)).toEqual(beforeOrder);
    for (const node of afterTree) {
      expect(beforeKeys.get(node.name)).toBeDefined();
      expect(node.sortOrder).toBe(beforeKeys.get(node.name)!);
    }
  });
});

describe('VocabularyService — category delete', () => {
  test('deletes the subtree, returns counts, and keeps the bookmarks', async () => {
    const { db, service, vector } = makeService();
    const parent = service.createCategory({ name: 'Parent' });
    const child = service.createCategory({ name: 'Child', parentId: parent.id });
    const bookmark = createBookmark(db, { url: 'https://example.com/a', categoryId: child.id });
    vector.ids.push(bookmark.id);

    const info = await service.deleteCategory(parent.id);

    // Subtree info is the confirmation UI's contract (MODEL.md deletion semantics).
    expect(info).toEqual({ categories: 2, bookmarks: 1 });
    expect(service.getCategoryTree()).toEqual([]);
    const survived = getBookmarkById(db, bookmark.id);
    expect(survived!.categoryId).toBeNull();
    // The vector payload mirrors the post-delete state.
    expect(vector.payloads).toEqual([
      { bookmarkId: bookmark.id, patch: { categoryId: null, tagIds: [] } },
    ]);
  });

  test('subtreeInfo counts without deleting', () => {
    const { db, service } = makeService();
    const parent = service.createCategory({ name: 'Parent' });
    service.createCategory({ name: 'Child', parentId: parent.id });
    createBookmark(db, { url: 'https://example.com/a', categoryId: parent.id });

    expect(service.subtreeInfo(parent.id)).toEqual({ categories: 2, bookmarks: 1 });
    expect(service.getCategoryTree()).toHaveLength(1);
  });

  test('deleting an unknown category is NotFoundError', async () => {
    const { service } = makeService();
    await expect(service.deleteCategory('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('VocabularyService — tags', () => {
  test('tag names are globally unique; renames collide', () => {
    const { service } = makeService();

    const rust = service.createTag({ name: 'rust' });
    expect(() => service.createTag({ name: 'rust' })).toThrow(ConflictError);

    const web = service.createTag({ name: 'web' });
    expect(() => service.updateTag(web.id, { name: 'rust' })).toThrow(ConflictError);
    expect(service.updateTag(rust.id, { name: 'rust' }).name).toBe('rust');
  });

  test('deleteTag resyncs the affected bookmarks with the tag removed', async () => {
    const { db, service, vector } = makeService();
    const category = createCategory(db, { name: 'dev' });
    const tag = createTag(db, { name: 'rust' });
    const bookmark = createBookmark(db, {
      url: 'https://example.com/a',
      categoryId: category.id,
    });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });
    vector.ids.push(bookmark.id);

    await service.deleteTag(tag.id);

    expect(vector.payloads.length).toBe(1);
    expect(vector.payloads[0]!.bookmarkId).toBe(bookmark.id);
    expect(vector.payloads[0]!.patch.tagIds).toEqual([]);
    expect(vector.payloads[0]!.patch.categoryId).toBe(category.id);
  });

  test('deletes on an empty index stay no-ops', async () => {
    const { db, service, vector } = makeService();
    const tag = createTag(db, { name: 'rust' });

    await service.deleteTag(tag.id);

    expect(vector.payloads).toEqual([]);
  });
});

describe('VocabularyService.setTagStatus', () => {
  // Candidate-set delta: tags have no category, so re-activating a tag makes it
  // a candidate for EVERY bookmark — the re-classify fan-out is the whole library.
  test('activating a deprecated tag fans classify jobs out to all bookmarks', () => {
    const { db, service, jobs } = makeService();

    const category = createCategory(db, { name: 'dev' });
    const tag = createTag(db, { name: 'rust' });
    setTagStatus(db, tag.id, 'deprecated');
    const inCategory = createBookmark(db, {
      url: 'https://example.com/a',
      categoryId: category.id,
    });
    const uncategorized = createBookmark(db, {
      url: 'https://example.com/outside',
    });

    const updated = service.setTagStatus(tag.id, 'active');

    expect(updated.status).toBe('active');
    const classified = jobs.calls.filter((call) => call.type === 'classify').map((call) => call.id);
    expect(classified.toSorted()).toEqual([inCategory.id, uncategorized.id].toSorted());
  });

  test('re-activating an already active tag enqueues nothing', () => {
    const { db, service, jobs } = makeService();

    const tag = createTag(db, { name: 'rust' });
    createBookmark(db, { url: 'https://example.com/a' });

    service.setTagStatus(tag.id, 'active');

    expect(jobs.calls).toEqual([]);
  });

  test('an unknown tag id is NotFoundError', () => {
    const { service } = makeService();

    expect(() => service.setTagStatus('11111111-1111-4111-8111-111111111111', 'active')).toThrow(
      NotFoundError,
    );
  });
});

describe('VocabularyService — events', () => {
  test('category mutations emit categories.changed, tag mutations tags.changed', async () => {
    const { service, events } = makeService();

    const category = service.createCategory({ name: 'Dev' });
    service.updateCategory(category.id, { description: 'dev things' });
    await service.deleteCategory(category.id);

    const tag = service.createTag({ name: 'rust' });
    service.updateTag(tag.id, { description: 'rust things' });
    service.setTagStatus(tag.id, 'deprecated');
    await service.deleteTag(tag.id);

    expect(events.events.filter((event) => event.topic === 'categories.changed').length).toBe(3);
    // create + update + deprecate + delete = four tag mutations.
    expect(events.events.filter((event) => event.topic === 'tags.changed').length).toBe(4);
  });
});
