import { describe, expect, test } from 'bun:test';

import type { VectorUpsert } from '@al-yo-bo/shared';

import {
  KnnIndex,
  fuseSearch,
  packFloat32,
  reciprocalRankFusion,
  unpackFloat32,
} from '../src/index.ts';

const rank = (id: string, position: number, score: number) => ({
  bookmarkId: id,
  rank: position,
  score,
});

const point = (bookmarkId: string, values: number[]): VectorUpsert => ({
  bookmarkId,
  vector: new Float32Array(values),
  payload: { model: 'test', dims: values.length, datasetId: 'd', categoryId: null, tagIds: [] },
});

describe('reciprocal rank fusion', () => {
  test('items present in both lists rank above items in one list', () => {
    const listA = [rank('a', 1, 1), rank('b', 2, 0.5)];
    const listB = [rank('b', 1, 0.9), rank('c', 2, 0.5)];
    expect(reciprocalRankFusion([listA, listB]).map((hit) => hit.bookmarkId)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('a single list preserves its order (keyword-only)', () => {
    const fused = fuseSearch([rank('a', 1, 1), rank('b', 2, 0)], [], 'keyword');
    expect(fused.map((hit) => hit.bookmarkId)).toEqual(['a', 'b']);
  });

  test('semantic mode degrades to keyword results when no embeddings exist', () => {
    const fused = fuseSearch([rank('a', 1, 1)], [], 'semantic');
    expect(fused.map((hit) => hit.bookmarkId)).toEqual(['a']);
  });
});

describe('pack / unpack', () => {
  test('round-trips Float32 values as little-endian bytes', () => {
    const values = new Float32Array([0.1, -2.5, 3, 0]);
    const bytes = packFloat32(values);
    expect(bytes.byteLength).toBe(16);
    expect(Array.from(unpackFloat32(bytes))).toEqual(Array.from(values));
  });
});

describe('KnnIndex', () => {
  test('returns nearest neighbours by cosine similarity', async () => {
    const index = new KnnIndex();
    index.load([
      { bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) },
      { bookmarkId: 'y', embedding: packFloat32(new Float32Array([0, 1])) },
      { bookmarkId: 'z', embedding: packFloat32(new Float32Array([0.9, 0.1])) },
    ]);

    const hits = await index.search(new Float32Array([1, 0]), 2);
    expect(hits.map((hit) => hit.bookmarkId)).toEqual(['x', 'z']);
  });

  test('upsert adds a new vector write-through', async () => {
    const index = new KnnIndex();
    index.load([{ bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) }]);
    await index.upsert(point('new', [0, 1]));

    expect(index.size).toBe(2);
    expect((await index.search(new Float32Array([0, 1]), 1))[0]?.bookmarkId).toBe('new');
  });

  test('upsert does not mutate the caller vector and ranking still works', async () => {
    const index = new KnnIndex();
    index.load([{ bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) }]);
    // Unnormalized on purpose: the durable embedding bytes staged for SQLite.
    const vector = new Float32Array([3, 4]);
    await index.upsert({
      bookmarkId: 'new',
      vector,
      payload: { model: 'test', dims: 2, datasetId: 'd', categoryId: null, tagIds: [] },
    });

    expect(Array.from(vector)).toEqual([3, 4]);
    // Normalized [3, 4] → [0.6, 0.8], so it outranks the [1, 0] row for query [0, 1].
    expect((await index.search(new Float32Array([0, 1]), 2)).map((hit) => hit.bookmarkId)).toEqual([
      'new',
      'x',
    ]);
  });

  test('rejects dimension mismatches', async () => {
    const index = new KnnIndex();
    index.load([{ bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) }]);
    await expect(index.upsert(point('y', [1, 0, 0]))).rejects.toThrow();
    await expect(index.search(new Float32Array([1, 0, 0]), 1)).rejects.toThrow();
  });

  test('delete removes the vector and shrinks the index', async () => {
    const index = new KnnIndex();
    index.load([
      { bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) },
      { bookmarkId: 'y', embedding: packFloat32(new Float32Array([0, 1])) },
      { bookmarkId: 'z', embedding: packFloat32(new Float32Array([0.9, 0.1])) },
    ]);

    await index.delete('x');
    expect(index.size).toBe(2);
    expect((await index.search(new Float32Array([1, 0]), 3)).map((hit) => hit.bookmarkId)).toEqual([
      'z',
      'y',
    ]);

    await index.delete('unknown');
    expect(index.size).toBe(2);
  });
});
