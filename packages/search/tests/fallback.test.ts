import { describe, expect, test } from 'bun:test';

import type {
  RankedCandidate,
  VectorFilter,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';

import { FallbackVectorIndex } from '../src/index.ts';

const rank = (id: string, position: number, score: number): RankedCandidate => ({
  bookmarkId: id,
  rank: position,
  score,
});

const point = (bookmarkId: string): VectorUpsert => ({
  bookmarkId,
  vector: new Float32Array([1, 0]),
  payload: { model: 'test', dims: 2, datasetId: 'd', categoryId: null, tagIds: [] },
});

class StubVectorIndex implements VectorIndex {
  size = 0;
  failure: Error | null = null;
  readonly searchCalls: { query: Float32Array; topK: number; filter?: VectorFilter }[] = [];
  readonly upsertCalls: VectorUpsert[] = [];
  readonly updatePayloadCalls: { bookmarkId: string; patch: VectorPayloadPatch }[] = [];
  readonly deleteCalls: string[] = [];

  constructor(private readonly results: RankedCandidate[] = []) {}

  private assertOk(): void {
    if (this.failure) {
      throw this.failure;
    }
  }

  async upsert(upsertPoint: VectorUpsert): Promise<void> {
    this.upsertCalls.push(upsertPoint);
    this.assertOk();
  }

  async updatePayload(bookmarkId: string, patch: VectorPayloadPatch): Promise<void> {
    this.updatePayloadCalls.push({ bookmarkId, patch });
    this.assertOk();
  }

  async delete(bookmarkId: string): Promise<void> {
    this.deleteCalls.push(bookmarkId);
    this.assertOk();
  }

  async search(query: Float32Array, topK: number, filter?: VectorFilter): Promise<RankedCandidate[]> {
    this.searchCalls.push({ query, topK, filter });
    this.assertOk();
    return this.results;
  }
}

describe('FallbackVectorIndex', () => {
  test('uses the healthy primary without touching the fallback', async () => {
    const primary = new StubVectorIndex([rank('p', 1, 0.9)]);
    const fallback = new StubVectorIndex([rank('f', 1, 0.5)]);
    const index = new FallbackVectorIndex(primary, fallback);

    const out = await index.search(new Float32Array([1, 0]), 5);
    expect(out.map((hit) => hit.bookmarkId)).toEqual(['p']);
    expect(fallback.searchCalls.length).toBe(0);
  });

  test('serves fallback results on primary failure and skips the primary next call', async () => {
    const primary = new StubVectorIndex([rank('p', 1, 0.9)]);
    const fallback = new StubVectorIndex([rank('f', 1, 0.5)]);
    const index = new FallbackVectorIndex(primary, fallback);
    primary.failure = new Error('qdrant down');

    const first = await index.search(new Float32Array([1, 0]), 5);
    expect(first.map((hit) => hit.bookmarkId)).toEqual(['f']);

    const second = await index.search(new Float32Array([1, 0]), 5);
    expect(second.map((hit) => hit.bookmarkId)).toEqual(['f']);
    expect(primary.searchCalls.length).toBe(1);
    expect(fallback.searchCalls.length).toBe(2);
  });

  test('retries the primary once the cooldown expires', async () => {
    const primary = new StubVectorIndex([rank('p', 1, 0.9)]);
    const fallback = new StubVectorIndex([rank('f', 1, 0.5)]);
    const index = new FallbackVectorIndex(primary, fallback, { cooldownMs: 10 });
    primary.failure = new Error('qdrant down');

    await index.search(new Float32Array([1, 0]), 5);
    expect(primary.searchCalls.length).toBe(1);

    primary.failure = null;
    await Bun.sleep(15);
    const recovered = await index.search(new Float32Array([1, 0]), 5);
    expect(recovered.map((hit) => hit.bookmarkId)).toEqual(['p']);
    expect(primary.searchCalls.length).toBe(2);
  });

  test('overfetches and filters client-side on the fallback path', async () => {
    const primary = new StubVectorIndex();
    primary.failure = new Error('qdrant down');
    const fallback = new StubVectorIndex([
      rank('a', 1, 0.9),
      rank('b', 2, 0.8),
      rank('c', 3, 0.7),
      rank('d', 4, 0.6),
    ]);
    const index = new FallbackVectorIndex(primary, fallback, {
      resolvePayloads: () =>
        new Map([
          ['a', { datasetId: 'd', categoryId: 'cat', tagIds: [] }],
          ['b', { datasetId: 'd', categoryId: 'other', tagIds: [] }],
          ['c', { datasetId: 'other', categoryId: 'cat', tagIds: [] }],
        ]),
      overfetchFactor: 4,
    });

    const out = await index.search(new Float32Array([1, 0]), 2, { categoryId: 'cat' });
    expect(fallback.searchCalls[0]?.topK).toBe(8);
    expect(out.map((hit) => hit.bookmarkId)).toEqual(['a', 'c']);
    expect(out.map((hit) => hit.rank)).toEqual([1, 3]);
  });

  // The dataset boundary must hold on the fallback path too (MODEL.md
  // principle 1): candidates from other datasets never reach fusion.
  test('filters candidates from other datasets out of the fallback path', async () => {
    const primary = new StubVectorIndex();
    primary.failure = new Error('qdrant down');
    const fallback = new StubVectorIndex([
      rank('a', 1, 0.9),
      rank('c', 2, 0.8),
      rank('d', 3, 0.7),
    ]);
    const index = new FallbackVectorIndex(primary, fallback, {
      resolvePayloads: () =>
        new Map([
          ['a', { datasetId: 'd', categoryId: null, tagIds: [] }],
          ['c', { datasetId: 'other', categoryId: null, tagIds: [] }],
          ['d', { datasetId: 'd', categoryId: null, tagIds: [] }],
        ]),
      overfetchFactor: 4,
    });

    const out = await index.search(new Float32Array([1, 0]), 2, { datasetId: 'd' });
    expect(out.map((hit) => hit.bookmarkId)).toEqual(['a', 'd']);
  });

  test('upsert, updatePayload and delete fan out to both indices', async () => {
    const primary = new StubVectorIndex();
    const fallback = new StubVectorIndex();
    const index = new FallbackVectorIndex(primary, fallback);

    await index.upsert(point('x'));
    await index.updatePayload('x', { tagIds: ['t1'] });
    await index.delete('x');

    expect(primary.upsertCalls.map((call) => call.bookmarkId)).toEqual(['x']);
    expect(fallback.upsertCalls.map((call) => call.bookmarkId)).toEqual(['x']);
    expect(primary.updatePayloadCalls[0]?.bookmarkId).toBe('x');
    expect(fallback.updatePayloadCalls[0]?.bookmarkId).toBe('x');
    expect(primary.deleteCalls).toEqual(['x']);
    expect(fallback.deleteCalls).toEqual(['x']);
  });

  test('a throwing primary does not reject the write', async () => {
    const primary = new StubVectorIndex();
    primary.failure = new Error('qdrant down');
    const fallback = new StubVectorIndex();
    const index = new FallbackVectorIndex(primary, fallback);

    await expect(index.upsert(point('x'))).resolves.toBeUndefined();
    expect(fallback.upsertCalls.map((call) => call.bookmarkId)).toEqual(['x']);
  });
});
