import { describe, expect, test } from 'bun:test';

import { assignTag, createBookmark, createCategory, createTag } from '@al-yo-bo/db';

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
    datasetId: db.datasetId,
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
    createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/1', title: 'one' });
    createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/2', title: 'two' });
    createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/3', title: 'three' });

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
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      title: 'rust one',
    });
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/b',
      title: 'rust two',
    });
    createBookmark(db, {
      datasetId: db.datasetId,
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
});

describe('SearchService — fused pagination', () => {
  test('reports a monotonic total lower bound and an exact hasMore probe', async () => {
    const db = makeDb();
    const a = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      title: 'alpha rust',
    });
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/b',
      title: 'beta rust',
    });
    // Semantic-only hit (no keyword match) so fusion has something to add.
    const c = createBookmark(db, {
      datasetId: db.datasetId,
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
      datasetId: db.datasetId,
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
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      title: 'rust one',
    });
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/b',
      title: 'rust two',
    });
    const service = createSearchService({
      db,
      config: testConfig(),
      vector: createVectorProvider(new StubVectorIndex(['missing']), 'memory'),
      embeddings: undefined,
      datasetId: db.datasetId,
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

  // The dataset boundary is pushed into the vector query (MODEL.md principle
  // 1): semantic search is dataset-scoped exactly like keyword search.
  test('pushes the dataset boundary into the semantic query', async () => {
    const db = makeDb();
    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      title: 'rust one',
    });
    const vector = new StubVectorIndex([bookmark.id]);
    const service = createSearchService({
      db,
      config: testConfig(),
      vector: createVectorProvider(vector, 'memory'),
      embeddings: stubEmbeddings,
      datasetId: db.datasetId,
    });

    await service.search({ q: 'rust', mode: 'semantic', ...BASE, limit: 10, offset: 0 });
    expect(vector.searchFilters.at(-1)).toMatchObject({ datasetId: db.datasetId });

    // An explicit input datasetId wins, matching the keyword path's precedence.
    const other = '00000000-0000-7000-8000-000000000001';
    await service.search({
      q: 'rust',
      mode: 'semantic',
      ...BASE,
      datasetId: other,
      limit: 10,
      offset: 0,
    });
    expect(vector.searchFilters.at(-1)).toMatchObject({ datasetId: other });
  });
});

describe('SearchService — chatHits', () => {
  test('projects compact LLM-friendly hits with resolved tag and category names', async () => {
    const { service, db } = makeService();
    const category = createCategory(db, { datasetId: db.datasetId, name: 'Design' });
    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/palette',
      title: 'color tools',
      description: 'palette generators',
      categoryId: category.id,
    });
    const tag = createTag(db, { datasetId: db.datasetId, name: 'color' });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });

    const hits = await service.chatHits('color', 5);

    expect(hits).toHaveLength(1);
    const [hit] = hits;
    if (!hit) throw new Error('expected one hit');
    // The projection is the chat tool's contract: names, never ids; never page
    // content (packages/core/src/dto.ts).
    expect(hit).toEqual({
      id: bookmark.id,
      url: 'https://example.com/palette',
      title: 'color tools',
      description: 'palette generators',
      tags: ['color'],
      categoryName: 'Design',
      updatedAt: expect.any(Number),
    });
    expect('content' in hit).toBe(false);
  });

  test('answers blank queries with no hits', async () => {
    const { service, db } = makeService();
    createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/1', title: 'one' });

    expect(await service.chatHits('', 5)).toEqual([]);
    expect(await service.chatHits('   ', 5)).toEqual([]);
  });

  test('caps hits at the requested limit', async () => {
    const { service, db } = makeService();
    createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/a', title: 'rust a' });
    createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/b', title: 'rust b' });
    createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/c', title: 'rust c' });

    const hits = await service.chatHits('rust', 2);

    expect(hits).toHaveLength(2);
  });
});
