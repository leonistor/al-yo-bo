import { beforeEach, describe, expect, test } from 'bun:test';

import { openDatabase, seedFromFile, setupDatabase } from '@al-yo-bo/db';
import type {
  RankedCandidate,
  VectorFilter,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';

import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/env.ts';

/** Deterministic VectorIndex stub: candidates come back in insertion order. */
class StubVectorIndex implements VectorIndex {
  constructor(readonly ids: string[]) {}

  get size(): number {
    return this.ids.length;
  }

  async upsert(_point: VectorUpsert): Promise<void> {}

  async updatePayload(_bookmarkId: string, _patch: VectorPayloadPatch): Promise<void> {}

  async delete(_bookmarkId: string): Promise<void> {}

  async search(
    _query: Float32Array,
    topK: number,
    _filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    return this.ids.slice(0, Math.max(0, topK)).map((bookmarkId, index) => ({
      bookmarkId,
      rank: index + 1,
      score: 1 / (index + 1),
    }));
  }
}

/** EmbeddingClient stub returning a fixed unit-ish vector. */
const stubEmbeddings = {
  async embed(texts: string[]) {
    return {
      vectors: texts.map(() => Float32Array.from([1, 0, 0])),
      dims: 3,
      model: 'stub',
    };
  },
};

function makeApp(services?: Parameters<typeof createApp>[2]) {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  seedFromFile(db);
  const env = services?.embeddings ? { EMBEDDING_MODEL: 'stub-model' } : {};
  return { db, app: createApp(db, loadConfig(env), services) };
}

/** First N seeded bookmark ids, in listing order. */
async function firstSeededIds(app: ReturnType<typeof createApp>, count: number): Promise<string[]> {
  const body = (await (await app.request(`/api/bookmarks?limit=${count}`)).json()) as {
    items: { id: string }[];
  };
  return body.items.map((bookmark) => bookmark.id);
}

function jsonRequest(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('bookmark API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  test('lists the seeded library', async () => {
    const response = await app.request('/api/bookmarks');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(26);
    expect(body.items.length).toBe(20);
  });

  test('searches by keyword', async () => {
    const response = await app.request('/api/bookmarks?q=sqlite');
    const body = (await response.json()) as { total: number; mode: string };
    expect(body.total).toBeGreaterThan(0);
    expect(body.mode).toBe('keyword');
  });

  test('keyword pagination is exact', async () => {
    const page1 = (await (await app.request('/api/bookmarks?limit=10')).json()) as {
      total: number;
      items: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(page1.total).toBe(26);
    expect(page1.items.length).toBe(10);
    expect(page1.pagination.hasMore).toBe(true);

    const page3 = (await (await app.request('/api/bookmarks?limit=10&offset=20')).json()) as {
      items: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(page3.items.length).toBe(6);
    expect(page3.pagination.hasMore).toBe(false);
  });

  test('health reports vector and embeddings status', async () => {
    const body = (await (await app.request('/api/health')).json()) as {
      status: string;
      vector: { backend: string; indexed: number };
      embeddings: { enabled: boolean };
    };
    expect(body.status).toBe('ok');
    expect(body.vector.backend).toBe('memory');
    expect(body.vector.indexed).toBe(0);
    expect(body.embeddings.enabled).toBe(false);
  });

  test('creates, updates and deletes a bookmark', async () => {
    const created = await app.request(
      '/api/bookmarks',
      jsonRequest({ url: 'https://example.com/new', title: 'New' }),
    );
    expect(created.status).toBe(201);
    const bookmark = (await created.json()) as { id: string; url: string; title: string };

    const patched = await app.request(
      `/api/bookmarks/${bookmark.id}`,
      jsonRequest({ title: 'Renamed' }, 'PATCH'),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { title: string }).title).toBe('Renamed');

    const removed = await app.request(`/api/bookmarks/${bookmark.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const missing = await app.request(`/api/bookmarks/${bookmark.id}`);
    expect(missing.status).toBe(404);
  });

  test('rejects invalid input with a problem+json error', async () => {
    const response = await app.request('/api/bookmarks', jsonRequest({}));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { title: string };
    expect(body.title).toContain('url');
  });

  test('assigns and removes a user tag', async () => {
    const bookmarks = (await (await app.request('/api/bookmarks?limit=1')).json()) as {
      items: { id: string }[];
    };
    const tags = (await (await app.request('/api/tags')).json()) as { id: string; name: string }[];
    const bookmarkId = bookmarks.items[0]!.id;
    const tagId = tags[0]!.id;

    const assigned = await app.request(`/api/bookmarks/${bookmarkId}/tags`, jsonRequest({ tagId }));
    expect(assigned.status).toBe(200);
    const withTags = (await assigned.json()) as { tags: { tagId: string; source: string }[] };
    expect(withTags.tags.some((tag) => tag.tagId === tagId && tag.source === 'user')).toBe(true);

    const removed = await app.request(`/api/bookmarks/${bookmarkId}/tags/${tagId}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
  });

  test('aggregates report the full library', async () => {
    const body = (await (await app.request('/api/aggregates')).json()) as {
      total: number;
      categories: unknown[];
      tags: unknown[];
    };
    expect(body.total).toBe(26);
    expect(body.categories.length).toBe(8);
    expect(body.tags.length).toBe(51);
  });
});

describe('fused search pagination', () => {
  test('semantic mode pages over the fused ranking with an honest lower-bound total', async () => {
    const { db, app } = makeApp();
    const ids = await firstSeededIds(app, 5);
    // Same database, second app instance with the stub subsystems attached.
    const fusedApp = createApp(db, loadConfig({ EMBEDDING_MODEL: 'stub-model' }), {
      vector: new StubVectorIndex(ids),
      vectorBackend: 'memory',
      embeddings: stubEmbeddings,
    });

    // Page 1: limit 2 over 5 semantic candidates -> hasMore, total is the true count.
    const page1 = (await (
      await fusedApp.request('/api/bookmarks?q=zzzqqq&mode=semantic&limit=2')
    ).json()) as {
      total: number;
      mode: string;
      items: { id: string }[];
      pagination: { hasMore: boolean };
    };
    expect(page1.mode).toBe('semantic');
    expect(page1.items.length).toBe(2);
    expect(page1.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(page1.pagination.hasMore).toBe(true);
    // Lower bound: only window+1 candidates were probed; the total grows as the
    // user pages deeper and the server sees more of the ranking.
    expect(page1.total).toBe(3);

    // Page 2 (offset 2): probe now covers all 5 candidates -> total settles at 5.
    const page2 = (await (
      await fusedApp.request('/api/bookmarks?q=zzzqqq&mode=semantic&limit=2&offset=2')
    ).json()) as { total: number; items: { id: string }[]; pagination: { hasMore: boolean } };
    expect(page2.items.map((item) => item.id)).toEqual(ids.slice(2, 4));
    expect(page2.pagination.hasMore).toBe(true);
    expect(page2.total).toBe(5);

    // Page 3 (offset 4): one item left, window exhausted -> hasMore false.
    const page3 = (await (
      await fusedApp.request('/api/bookmarks?q=zzzqqq&mode=semantic&limit=2&offset=4')
    ).json()) as { total: number; items: { id: string }[]; pagination: { hasMore: boolean } };
    expect(page3.items.length).toBe(1);
    expect(page3.items[0]!.id).toBe(ids[4]!);
    expect(page3.pagination.hasMore).toBe(false);
    expect(page3.total).toBe(5);
  });

  test('semantic mode without embeddings degrades to keyword-only', async () => {
    const { app } = makeApp();
    const body = (await (await app.request('/api/bookmarks?q=sqlite&mode=semantic')).json()) as {
      mode: string;
    };
    expect(body.mode).toBe('keyword');
  });
});

describe('import API', () => {
  test('previews and imports markdown', async () => {
    const { app } = makeApp();
    const markdown = '## dev\n\n- ** Tool: https://example.com/tool\n';

    const preview = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: markdown,
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { parsed: number }).parsed).toBe(1);

    const imported = await app.request('/api/import?file=test.md', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: markdown,
    });
    expect(imported.status).toBe(200);
    expect(((await imported.json()) as { added: number }).added).toBe(1);
  });
});

describe('review API', () => {
  test('returns empty queues when nothing was classified', async () => {
    const { app } = makeApp();
    const proposed = await app.request('/api/review/proposed-tags');
    const candidates = await app.request('/api/review/candidates');
    expect(((await proposed.json()) as unknown[]).length).toBe(0);
    expect(((await candidates.json()) as unknown[]).length).toBe(0);
  });
});
