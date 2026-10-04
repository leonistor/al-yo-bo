import { afterAll, describe, expect, test } from 'bun:test';

import { packFloat32 } from '@al-yo-bo/shared';
import { QdrantClient } from '@qdrant/js-client-rest';

import { QdrantIndex, type SyncRecord } from '../src/index.ts';

const URL = process.env.QDRANT_TEST_URL;
const maybeDescribe = URL ? describe : describe.skip;
const BASE_URL = URL ?? 'http://127.0.0.1:6333';
const collection = `bookmarks-test-${Math.random().toString(36).slice(2, 10)}`;

const index = new QdrantIndex({ url: BASE_URL, collection });
const admin = new QdrantClient({ url: BASE_URL });

afterAll(async () => {
  try {
    await admin.deleteCollection(collection);
  } catch {
    // The collection may not exist if a test failed before it was created.
  }
});

const syncRecord = (bookmarkId: string, model: string, values: number[]): SyncRecord => ({
  bookmarkId,
  model,
  dims: values.length,
  embedding: packFloat32(Float32Array.from(values)),
});

const payload = (categoryId: string | null, tagIds: string[] = []) => ({
  categoryId,
  tagIds,
});
/** `resolvePayload` stub for syncs that carry no filterable payload. */
const nullPayload = () => payload(null);

// Qdrant point ids must be an unsigned int or a UUID string; production ids are
// the bookmarks' UUIDv7s, so the tests use UUID-shaped ids too.
const id = (n: number): string => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;

const idsOf = async (
  query: Float32Array,
  filter?: { categoryId?: string; tagId?: string },
) => {
  const hits = await index.search(query, 10, filter);
  return hits.map((hit) => hit.bookmarkId);
};

maybeDescribe('QdrantIndex', () => {
  test('ensureCollection is idempotent and records dims and model', async () => {
    await index.ensureCollection(2, 'test-model');
    await index.ensureCollection(2, 'test-model');

    const info = await admin.getCollection(collection);
    expect(info.config.metadata).toMatchObject({ model: 'test-model' });
    const vectors = info.config.params.vectors;
    expect(vectors && 'size' in vectors ? vectors.size : undefined).toBe(2);
  });

  test('upsert then search orders by cosine similarity', async () => {
    await index.upsert({
      bookmarkId: id(1),
      vector: new Float32Array([1, 0]),
      payload: { model: 'test-model', dims: 2, categoryId: null, tagIds: [] },
    });
    await index.upsert({
      bookmarkId: id(2),
      vector: new Float32Array([0, 1]),
      payload: { model: 'test-model', dims: 2, categoryId: null, tagIds: [] },
    });

    const hits = await index.search(new Float32Array([1, 0]), 5);
    expect(hits.map((hit) => hit.bookmarkId)).toEqual([id(1), id(2)]);
    expect(hits.map((hit) => hit.rank)).toEqual([1, 2]);
    expect(index.size).toBeGreaterThanOrEqual(2);
  });

  test('search filter respects categoryId and tagId', async () => {
    await index.upsert({
      bookmarkId: id(3),
      vector: new Float32Array([1, 0]),
      payload: { model: 'test-model', dims: 2, categoryId: 'catA', tagIds: ['tag1'] },
    });
    await index.upsert({
      bookmarkId: id(4),
      vector: new Float32Array([0.9, 0.1]),
      payload: { model: 'test-model', dims: 2, categoryId: 'catB', tagIds: ['tag2'] },
    });

    expect(await idsOf(new Float32Array([1, 0]), { categoryId: 'catA' })).toEqual([id(3)]);
    expect(await idsOf(new Float32Array([1, 0]), { tagId: 'tag2' })).toEqual([id(4)]);
    expect(await idsOf(new Float32Array([1, 0]), { categoryId: 'catA', tagId: 'tag2' })).toEqual([]);
    expect(await idsOf(new Float32Array([1, 0]), { categoryId: 'catB', tagId: 'tag1' })).toEqual([]);
  });

  test('updatePayload changes filter results', async () => {
    await index.upsert({
      bookmarkId: id(5),
      vector: new Float32Array([1, 0]),
      payload: { model: 'test-model', dims: 2, categoryId: null, tagIds: [] },
    });
    expect(await idsOf(new Float32Array([1, 0]), { categoryId: 'catX' })).not.toContain(id(5));

    await index.updatePayload(id(5), { categoryId: 'catX', tagIds: ['tagX'] });
    expect(await idsOf(new Float32Array([1, 0]), { categoryId: 'catX' })).toContain(id(5));
    expect(await idsOf(new Float32Array([1, 0]), { tagId: 'tagX' })).toContain(id(5));
  });

  test('delete removes a point from results', async () => {
    await index.upsert({
      bookmarkId: id(6),
      vector: new Float32Array([1, 0]),
      payload: { model: 'test-model', dims: 2, categoryId: null, tagIds: [] },
    });
    expect(await idsOf(new Float32Array([1, 0]))).toContain(id(6));

    await index.delete(id(6));
    expect(await idsOf(new Float32Array([1, 0]))).not.toContain(id(6));
  });

  test('sync rebuilds the full set from SQLite (delete-all + re-upsert)', async () => {
    const records = [
      syncRecord(id(7), 'sync-model', [1, 0]),
      syncRecord(id(8), 'sync-model', [0, 1]),
    ];
    const resolve = (bookmarkId: string) => payload(bookmarkId === id(7) ? 'catA' : null);

    const first = await index.sync(records, resolve);
    expect(first.skipped).toBe(false);
    expect(first.upserted).toBe(2);

    await index.upsert({
      bookmarkId: id(9),
      vector: new Float32Array([1, 0]),
      payload: { model: 'sync-model', dims: 2, categoryId: null, tagIds: [] },
    });

    // Every sync wipes and re-upserts the whole SQLite set, so the stray point
    // is gone and both records are written again even though nothing changed.
    const second = await index.sync(records, resolve);
    expect(second).toEqual({ upserted: 2, deleted: 3, recreated: false, skipped: false });
    expect(index.size).toBe(2);
  });

  test('sync re-upserts a record whose embedding changed in SQLite', async () => {
    const stale = [syncRecord(id(10), 'sync-model', [1, 0])];

    await index.sync(stale, nullPayload);
    const staleHits = await idsOf(new Float32Array([1, 0]));
    expect(staleHits[0]).toBe(id(10));

    // The id is unchanged but the embedding bytes differ; the id-only diff of
    // the old sync would have missed this.
    const fresh = [syncRecord(id(10), 'sync-model', [0, 1])];
    const report = await index.sync(fresh, nullPayload);
    expect(report.upserted).toBe(1);
    expect(report.skipped).toBe(false);

    const freshHits = await idsOf(new Float32Array([0, 1]));
    expect(freshHits[0]).toBe(id(10));
  });

  test('ensureCollection rebuilds a collection missing model metadata', async () => {
    const bare = `${collection}-bare`;
    try {
      // Same shape, but no `model` metadata: the stored points' model space is
      // unknown, so the collection must not be trusted.
      await admin.createCollection(bare, { vectors: { size: 2, distance: 'Cosine' } });
      const bareIndex = new QdrantIndex({ url: BASE_URL, collection: bare });

      await bareIndex.ensureCollection(2, 'test-model');

      const info = await admin.getCollection(bare);
      expect(info.config.metadata).toMatchObject({ model: 'test-model' });
    } finally {
      await admin.deleteCollection(bare).catch(() => {});
    }
  });
});
