import { describe, expect, test } from 'bun:test';

import {
  FilteringVectorIndex,
  KnnIndex,
  packFloat32,
  type FallbackPayload,
} from '../src/index.ts';

/** One bookmark's filterable state, mirroring what the server resolves from SQLite. */
const PAYLOADS = new Map<string, FallbackPayload>([
  ['a', { categoryId: 'cat', tagIds: ['t1'] }],
  ['b', { categoryId: 'other', tagIds: [] }],
  ['c', { categoryId: 'cat', tagIds: ['t1'] }],
]);

function record(bookmarkId: string, vector: number[]) {
  return { bookmarkId, embedding: packFloat32(Float32Array.from(vector)) };
}

/**
 * The in-memory path: a real `KnnIndex` wrapped in the filtering decorator,
 * exactly how `apps/server` serves when Qdrant is not configured. Vectors are
 * chosen so the similarity order is a > b > c for the query [1, 0].
 */
function memoryIndex(): FilteringVectorIndex {
  const knn = new KnnIndex();
  knn.load([record('a', [1, 0]), record('b', [0.8, 0.6]), record('c', [0, 1])]);
  return new FilteringVectorIndex(knn, {
    resolvePayloads: () => PAYLOADS,
    overfetchFactor: 4,
  });
}

describe('FilteringVectorIndex', () => {
  test('scopes results by category, excluding non-matching candidates', async () => {
    const out = await memoryIndex().search(new Float32Array([1, 0]), 3, { categoryId: 'other' });
    expect(out.map((hit) => hit.bookmarkId)).toEqual(['b']);
  });

  test('applies category filters and keeps earned ranks', async () => {
    const out = await memoryIndex().search(new Float32Array([1, 0]), 3, { categoryId: 'cat' });
    expect(out.map((hit) => hit.bookmarkId)).toEqual(['a', 'c']);
    // Ranks come from the overfetch window, not the filtered position.
    expect(out.map((hit) => hit.rank)).toEqual([1, 3]);
  });

  test('applies tag filters', async () => {
    const out = await memoryIndex().search(new Float32Array([1, 0]), 3, { tagId: 't1' });
    expect(out.map((hit) => hit.bookmarkId)).toEqual(['a', 'c']);
  });

  test('returns the unfiltered top-k when no filter is supplied', async () => {
    const out = await memoryIndex().search(new Float32Array([1, 0]), 2);
    expect(out.map((hit) => hit.bookmarkId)).toEqual(['a', 'b']);
  });

  test('delegates writes to the wrapped index', async () => {
    const knn = new KnnIndex();
    knn.load([record('a', [1, 0])]);
    const index = new FilteringVectorIndex(knn, { resolvePayloads: () => PAYLOADS });

    await index.upsert({
      bookmarkId: 'b',
      vector: Float32Array.from([0, 1]),
      payload: { model: 'test', dims: 2, categoryId: null, tagIds: [] },
    });
    expect(index.size).toBe(2);

    await index.delete('a');
    expect(index.size).toBe(1);
  });
});
