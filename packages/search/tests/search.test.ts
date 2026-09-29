import { describe, expect, test } from 'bun:test';

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
  test('returns nearest neighbours by cosine similarity', () => {
    const index = new KnnIndex();
    index.load([
      { bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) },
      { bookmarkId: 'y', embedding: packFloat32(new Float32Array([0, 1])) },
      { bookmarkId: 'z', embedding: packFloat32(new Float32Array([0.9, 0.1])) },
    ]);

    const hits = index.search(new Float32Array([1, 0]), 2);
    expect(hits.map((hit) => hit.bookmarkId)).toEqual(['x', 'z']);
  });

  test('upsert adds a new vector write-through', () => {
    const index = new KnnIndex();
    index.load([{ bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) }]);
    index.upsert('new', packFloat32(new Float32Array([0, 1])));

    expect(index.size).toBe(2);
    expect(index.search(new Float32Array([0, 1]), 1)[0]?.bookmarkId).toBe('new');
  });

  test('rejects dimension mismatches', () => {
    const index = new KnnIndex();
    index.load([{ bookmarkId: 'x', embedding: packFloat32(new Float32Array([1, 0])) }]);
    expect(() => index.upsert('y', packFloat32(new Float32Array([1, 0, 0])))).toThrow();
    expect(() => index.search(new Float32Array([1, 0, 0]), 1)).toThrow();
  });
});
