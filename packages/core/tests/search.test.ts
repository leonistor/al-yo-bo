import { describe, expect, test } from 'bun:test';

import { assignTag, createBookmark, createCategory, createTag } from '@al-yo-bo/db';
import { uuidToBytes } from '@al-yo-bo/shared';

import { createSearchService, type SearchService } from '../src/services/search.ts';
import { createVectorProvider } from '../src/vector/provider.ts';
import { StubVectorIndex, makeDb, stubEmbeddings, testConfig } from './support.ts';

/** Builds a SearchService over a fresh in-memory db. */
function makeService(
  vector = new StubVectorIndex(),
  withEmbeddings = true,
): { service: SearchService; db: ReturnType<typeof makeDb> } {
  const db = makeDb();
  const service = createSearchService({
    db,
    config: testConfig(),
    vector: createVectorProvider(vector, 'memory'),
    embeddings: withEmbeddings ? stubEmbeddings : undefined,
  });
  return { service, db };
}

const BASE = {
  status: 'active' as const,
  sort: 'created_at' as const,
  direction: 'desc' as const,
};

describe('SearchService — empty query', () => {
  test('lists bookmarks in keyword mode and reports hasMore past the page', async () => {
    const { service, db } = makeService();
    createBookmark(db, { url: 'https://example.com/1', title: 'one' });
    createBookmark(db, { url: 'https://example.com/2', title: 'two' });
    createBookmark(db, { url: 'https://example.com/3', title: 'three' });

    const response = await service.search({ q: '', mode: 'keyword', ...BASE, limit: 2, offset: 0 });

    expect(response.mode).toBe('keyword');
    expect(response.total).toBe(3);
    expect(response.items.length).toBe(2);
    expect(response.pagination).toEqual({ limit: 2, offset: 0, hasMore: true });
  });
});

describe('SearchService — keyword-only pagination', () => {
  test('total is the match count and hasMore flips on the last page', async () => {
    const { service, db } = makeService();
    createBookmark(db, {
      url: 'https://example.com/a',
      title: 'rust one',
    });
    createBookmark(db, {
      url: 'https://example.com/b',
      title: 'rust two',
    });
    createBookmark(db, {
      url: 'https://example.com/c',
      title: 'unrelated',
    });

    const first = await service.search({
      q: 'rust',
      mode: 'keyword',
      ...BASE,
      limit: 1,
      offset: 0,
    });
    expect(first.mode).toBe('keyword');
    expect(first.total).toBe(2);
    expect(first.items.length).toBe(1);
    expect(first.pagination.hasMore).toBe(true);

    const second = await service.search({
      q: 'rust',
      mode: 'keyword',
      ...BASE,
      limit: 1,
      offset: 1,
    });
    expect(second.total).toBe(2);
    expect(second.items.length).toBe(1);
    expect(second.pagination.hasMore).toBe(false);
  });

  test('a category filter matches the whole subtree', async () => {
    const { service, db } = makeService();
    const parent = createCategory(db, { name: 'Dev' });
    const child = createCategory(db, { name: 'Web', parentId: parent.id });
    createBookmark(db, { url: 'https://example.com/a', title: 'rust one', categoryId: parent.id });
    createBookmark(db, { url: 'https://example.com/b', title: 'rust two', categoryId: child.id });
    createBookmark(db, { url: 'https://example.com/c', title: 'rust three' });

    const response = await service.search({
      q: 'rust',
      mode: 'keyword',
      ...BASE,
      categoryId: parent.id,
      limit: 10,
      offset: 0,
    });

    expect(response.total).toBe(2); // parent + child; uncategorized excluded
  });
});

describe('SearchService — fused pagination', () => {
  test('reports a monotonic total lower bound and an exact hasMore probe', async () => {
    const db = makeDb();
    const a = createBookmark(db, {
      url: 'https://example.com/a',
      title: 'alpha rust',
    });
    createBookmark(db, {
      url: 'https://example.com/b',
      title: 'beta rust',
    });
    // Semantic-only hit (no keyword match) so fusion has something to add.
    const c = createBookmark(db, {
      url: 'https://example.com/c',
      title: 'gamma',
    });

    // Semantic ranking: c first, then a — only c fits the first window.
    const vector = new StubVectorIndex([c.id, a.id]);
    const service = createSearchService({
      db,
      config: testConfig(),
      vector: createVectorProvider(vector, 'memory'),
      embeddings: stubEmbeddings,
    });

    // limit 1 → window 1, probe fetches 2 from each list.
    const first = await service.search({ q: 'rust', mode: 'hybrid', ...BASE, limit: 1, offset: 0 });
    expect(first.mode).toBe('hybrid');
    expect(first.pagination.hasMore).toBe(true);
    // keywordTotal (2) vs window+1 (2): the lower bound never undercounts the keyword side.
    expect(first.total).toBe(2);
    expect(first.items.length).toBe(1);

    // A wide window consumes every candidate: hasMore false, total is what was seen.
    const all = await service.search({ q: 'rust', mode: 'hybrid', ...BASE, limit: 10, offset: 0 });
    expect(all.pagination.hasMore).toBe(false);
    expect(all.items.length).toBe(3); // a, b, c
    expect(all.total).toBe(3);
  });

  test('degrades to keyword-only when no embedding client is configured', async () => {
    const db = makeDb();
    createBookmark(db, {
      url: 'https://example.com/a',
      title: 'rust one',
    });
    createBookmark(db, {
      url: 'https://example.com/b',
      title: 'rust two',
    });
    const service = createSearchService({
      db,
      config: testConfig(),
      vector: createVectorProvider(new StubVectorIndex(['missing']), 'memory'),
      embeddings: undefined,
    });

    const response = await service.search({
      q: 'rust',
      mode: 'hybrid',
      ...BASE,
      limit: 10,
      offset: 0,
    });
    expect(response.mode).toBe('keyword');
    expect(response.total).toBe(2);
  });

  test('date-bounded searches stay keyword-only', async () => {
    const db = makeDb();
    createBookmark(db, { url: 'https://example.com/a', title: 'rust one' });
    const vector = new StubVectorIndex(['x']);
    const service = createSearchService({
      db,
      config: testConfig(),
      vector: createVectorProvider(vector, 'memory'),
      embeddings: stubEmbeddings,
    });

    const response = await service.search({
      q: 'rust',
      mode: 'hybrid',
      ...BASE,
      dateFrom: 0,
      limit: 10,
      offset: 0,
    });

    expect(response.mode).toBe('keyword');
    expect(vector.searchFilters).toEqual([]); // the vector query was never made
  });

  // The filters are pushed into the vector query (server-side on Qdrant,
  // client-side overfetch on the fallback) — no dataset axis is left (MODEL.md
  // principle 1); category/tag filters are the only predicates.
  test('pushes the category/tag filters into the semantic query', async () => {
    const db = makeDb();
    const category = createCategory(db, { name: 'Dev' });
    const tag = createTag(db, { name: 'rust' });
    const bookmark = createBookmark(db, {
      url: 'https://example.com/a',
      title: 'rust one',
      categoryId: category.id,
    });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });
    const vector = new StubVectorIndex([bookmark.id]);
    const service = createSearchService({
      db,
      config: testConfig(),
      vector: createVectorProvider(vector, 'memory'),
      embeddings: stubEmbeddings,
    });

    await service.search({
      q: 'rust',
      mode: 'semantic',
      ...BASE,
      categoryId: category.id,
      tagId: tag.id,
      limit: 10,
      offset: 0,
    });
    expect(vector.searchFilters.at(-1)).toEqual({ categoryId: category.id, tagId: tag.id });
  });
});

describe('SearchService — chatHits', () => {
  test('projects compact LLM-friendly hits with resolved tag and category names', async () => {
    const { service, db } = makeService();
    const category = createCategory(db, { name: 'Design' });
    const bookmark = createBookmark(db, {
      url: 'https://example.com/palette',
      title: 'color tools',
      description: 'palette generators',
      categoryId: category.id,
      metadata: { image: { ogImageUrl: 'https://img.test/palette.png', screenshotPath: null } },
    });
    const tag = createTag(db, { name: 'color' });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });

    const hits = await service.chatHits('color', 5);

    expect(hits).toHaveLength(1);
    const [hit] = hits;
    if (!hit) throw new Error('expected one hit');
    // The projection is the chat tool's contract: names, never ids; never page
    // content (packages/core/src/dto.ts). `image` carries the UI's thumbnail
    // references so chat tiles show screenshots instead of placeholders.
    expect(hit).toEqual({
      id: bookmark.id,
      url: 'https://example.com/palette',
      title: 'color tools',
      description: 'palette generators',
      tags: ['color'],
      categoryName: 'Design',
      image: { ogImageUrl: 'https://img.test/palette.png', screenshotPath: null },
      updatedAt: expect.any(Number),
    });
    expect('content' in hit).toBe(false);
  });

  test('nulls the image for bookmarks without scrape metadata', async () => {
    const { service, db } = makeService();
    createBookmark(db, { url: 'https://example.com/1', title: 'one' });

    const [hit] = await service.chatHits('one', 5);

    expect(hit?.image).toEqual({ ogImageUrl: null, screenshotPath: null });
  });

  test('answers blank queries with no hits', async () => {
    const { service, db } = makeService();
    createBookmark(db, { url: 'https://example.com/1', title: 'one' });

    expect(await service.chatHits('', 5)).toEqual([]);
    expect(await service.chatHits('   ', 5)).toEqual([]);
  });

  test('caps hits at the requested limit', async () => {
    const { service, db } = makeService();
    createBookmark(db, { url: 'https://example.com/a', title: 'rust a' });
    createBookmark(db, { url: 'https://example.com/b', title: 'rust b' });
    createBookmark(db, { url: 'https://example.com/c', title: 'rust c' });

    const hits = await service.chatHits('rust', 2);

    expect(hits).toHaveLength(2);
  });
});

describe('SearchService — aggregates', () => {
  test('counts bookmarks, invalid ones, and per-category/tag totals', async () => {
    const { service, db } = makeService();
    const category = createCategory(db, { name: 'Dev' });
    const first = createBookmark(db, {
      url: 'https://example.com/1',
      title: 'one',
      categoryId: category.id,
    });
    const second = createBookmark(db, { url: 'https://example.com/2', title: 'two' });
    updateStatus(db, second.id, 'invalid');
    const tag = createTag(db, { name: 'rust' });
    assignTag(db, { bookmarkId: first.id, tagId: tag.id, source: 'user' });

    const aggregates = service.aggregates();

    expect(aggregates.total).toBe(2);
    expect(aggregates.invalidCount).toBe(1);
    expect(aggregates.categories).toEqual([
      { id: category.id, parentId: null, name: 'Dev', count: 1 },
    ]);
    expect(aggregates.tags).toEqual([{ id: tag.id, name: 'rust', status: 'active', count: 1 }]);
  });
});

/** Flips a bookmark to `invalid` directly (db-level, no service involved). */
function updateStatus(db: ReturnType<typeof makeDb>, id: string, status: 'invalid'): void {
  // Ids are 16-byte BLOBs (MODEL.md); bind the bytes, not the string form.
  db.query('UPDATE bookmarks SET status = ? WHERE id = ?').run(status, uuidToBytes(id));
}
