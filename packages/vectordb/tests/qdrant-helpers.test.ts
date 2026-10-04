import { describe, expect, test } from 'bun:test';

import {
  assertUniformDims,
  buildPointPayload,
  buildVectorFilter,
  chunk,
  type SyncRecord,
} from '../src/index.ts';

const record = (bookmarkId: string, dims: number): SyncRecord => ({
  bookmarkId,
  model: 'test-model',
  dims,
  embedding: new Uint8Array(dims * 4),
});

describe('buildVectorFilter', () => {
  test('returns undefined when no condition is present', () => {
    expect(buildVectorFilter()).toBeUndefined();
    expect(buildVectorFilter({})).toBeUndefined();
  });

  test('matches categoryId by value', () => {
    expect(buildVectorFilter({ categoryId: 'c1' })).toEqual({
      must: [{ key: 'categoryId', match: { value: 'c1' } }],
    });
  });

  test('matches tagId against the tagIds array', () => {
    expect(buildVectorFilter({ tagId: 't1' })).toEqual({
      must: [{ key: 'tagIds', match: { any: ['t1'] } }],
    });
  });

  test('ANDs all present conditions in a single must list', () => {
    expect(buildVectorFilter({ categoryId: 'c1', tagId: 't1' })).toEqual({
      must: [
        { key: 'categoryId', match: { value: 'c1' } },
        { key: 'tagIds', match: { any: ['t1'] } },
      ],
    });
  });
});

describe('buildPointPayload', () => {
  test('stamps model and dims even without filterable payload', () => {
    expect(buildPointPayload('m', 3)).toEqual({ model: 'm', dims: 3 });
  });

  test('adds categoryId and tagIds when provided', () => {
    expect(
      buildPointPayload('m', 3, { categoryId: 'c', tagIds: ['t'] }),
    ).toEqual({
      model: 'm',
      dims: 3,
      categoryId: 'c',
      tagIds: ['t'],
    });
  });

  test('keeps a null category explicit', () => {
    expect(
      buildPointPayload('m', 3, { categoryId: null, tagIds: [] }),
    ).toEqual({
      model: 'm',
      dims: 3,
      categoryId: null,
      tagIds: [],
    });
  });
});

describe('chunk', () => {
  test('splits into full batches plus a remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('returns a single batch when items fit', () => {
    expect(chunk(['a', 'b'], 200)).toEqual([['a', 'b']]);
  });

  test('returns an empty list for no items', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  test('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
  });
});

describe('assertUniformDims', () => {
  test('returns the shared dimension', () => {
    expect(assertUniformDims([record('a', 2), record('b', 2)])).toBe(2);
  });

  test('returns 0 for an empty batch', () => {
    expect(assertUniformDims([])).toBe(0);
  });

  test('throws on mixed dimensions', () => {
    expect(() => assertUniformDims([record('a', 2), record('b', 4)])).toThrow(
      /dimension mismatch/,
    );
  });
});
