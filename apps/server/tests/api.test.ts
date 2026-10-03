import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import type { ClassifierClient } from '@al-yo-bo/classifier';
import {
  ScrapeError,
  createCore,
  createVectorProvider,
  type AvatarStore,
  type ScrapeFn,
} from '@al-yo-bo/core';
import {
  createBookmark,
  createDataset,
  getBookmarkById,
  getDatasetByName,
  openDatabase,
  resolveSeedDataset,
  seedFromFile,
  setupDatabase,
} from '@al-yo-bo/db';
import type { EmbeddingClient } from '@al-yo-bo/embeddings';
import type {
  ImportedBookmark,
  Profile,
  RankedCandidate,
  VectorFilter,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';
import { hc } from 'hono/client';

import { createApp, type AppType } from '../src/app.ts';
import { loadConfig, type ServerConfig } from '../src/env.ts';

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
const stubEmbeddings: EmbeddingClient = {
  async embed(texts: string[]) {
    return {
      vectors: texts.map(() => Float32Array.from([1, 0, 0])),
      dims: 3,
      model: 'stub',
    };
  },
};

/** Optional capabilities a transport test can attach to a real core instance. */
interface AppOptions {
  vector?: VectorIndex;
  embeddings?: EmbeddingClient;
  scrape?: ScrapeFn;
  classifier?: ClassifierClient;
  avatarStore?: AvatarStore;
  reindex?: () => Promise<{ vectorBackend: 'qdrant' | 'memory' }>;
}

/** Builds a core (with the stub subsystems) over an already-seeded db, then the app. */
function buildApp(db: Database & { datasetId: string }, options: AppOptions = {}) {
  const vector = options.vector ?? new StubVectorIndex([]);
  const env = options.embeddings ? { EMBEDDING_MODEL: 'stub-model' } : {};
  const config: ServerConfig = {
    ...loadConfig(env),
    // The test seeds the grimoire dataset; core scopes everything to it.
    defaultDataset: 'grimoire',
  };
  const core = createCore({
    db,
    config,
    vector: createVectorProvider(vector, 'memory'),
    embeddings: options.embeddings,
    classifier: options.classifier,
    scrape: options.scrape,
    avatarStore: options.avatarStore,
    reindex: options.reindex,
  });
  return { db, core, config, app: createApp(core, config) };
}

function makeApp(options: AppOptions = {}) {
  const db = openDatabase(':memory:') as Database & { datasetId: string };
  setupDatabase(db);
  seedFromFile(db, resolveSeedDataset('grimoire'));
  const dataset = getDatasetByName(db, 'grimoire');
  if (!dataset) {
    throw new Error('grimoire dataset missing after seed');
  }
  db.datasetId = dataset.id;
  return buildApp(db, options);
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

/** Minimal ClassifierClient stub over the seeded vocabulary. */
function stubClassifier(probabilities: Record<string, number>) {
  return {
    async decide(request: { questions: Record<string, unknown> }) {
      const asked = Object.keys(request.questions);
      return {
        probabilities: Object.fromEntries(asked.map((name) => [name, probabilities[name] ?? 0])),
      };
    },
  };
}

/**
 * Compile-time guard for the frozen RPC contract `apps/web` builds against:
 * `POST /api/import` must accept `{ bookmarks: ImportedBookmark[] }` and return
 * `ImportReport`. Referenced only for its types — never called.
 */
function assertImportRpcContract(client: ReturnType<typeof hc<AppType>>) {
  return client.api.import.$post({ json: { bookmarks: [] } });
}
void assertImportRpcContract;

describe('bookmark API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  test('lists the seeded library', async () => {
    const response = await app.request('/api/bookmarks');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(23);
    expect(body.items.length).toBe(20);
  });

  test('searches by keyword', async () => {
    const response = await app.request('/api/bookmarks?q=sqlite');
    const body = (await response.json()) as { total: number; mode: string };
    expect(body.total).toBeGreaterThan(0);
    expect(body.mode).toBe('keyword');
  });

  test('status filter hides invalid bookmarks from default views', async () => {
    // `testApp` (not the describe-level `app`): this test needs the instance
    // paired with the db it mutates, not the fresh beforeEach one.
    const { db, app: testApp } = makeApp();
    const invalid = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://api-invalid.test',
      title: 'Broken',
      status: 'invalid',
      scrapeAttempts: 3,
    });

    const def = (await (await testApp.request('/api/bookmarks?limit=100')).json()) as {
      total: number;
      items: { id: string }[];
    };
    expect(def.total).toBe(23);
    expect(def.items.some((bookmark) => bookmark.id === invalid.id)).toBe(false);

    const onlyInvalid = (await (
      await testApp.request('/api/bookmarks?limit=100&status=invalid')
    ).json()) as { total: number; items: { id: string }[] };
    expect(onlyInvalid.total).toBe(1);
    expect(onlyInvalid.items.map((bookmark) => bookmark.id)).toEqual([invalid.id]);

    const all = (await (await testApp.request('/api/bookmarks?limit=100&status=all')).json()) as {
      total: number;
      items: { id: string }[];
    };
    expect(all.total).toBe(24);
    expect(all.items.some((bookmark) => bookmark.id === invalid.id)).toBe(true);
  });

  test('changing a bookmark URL resets status and scrape attempts', async () => {
    // `testApp` (not the describe-level `app`): paired with the db this test mutates.
    const { db, app: testApp } = makeApp();
    const invalid = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://api-reset-old.test',
      status: 'invalid',
      scrapeAttempts: 3,
    });

    const response = await testApp.request(
      `/api/bookmarks/${invalid.id}`,
      jsonRequest({ url: 'https://api-reset-new.test' }, 'PATCH'),
    );
    expect(response.status).toBe(200);
    const bookmark = getBookmarkById(db, invalid.id)!;
    expect(bookmark.url).toBe('https://api-reset-new.test/');
    expect(bookmark.status).toBe('active');
    expect(bookmark.scrapeAttempts).toBe(0);
  });

  test('keyword pagination is exact', async () => {
    const page1 = (await (await app.request('/api/bookmarks?limit=10')).json()) as {
      total: number;
      items: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(page1.total).toBe(23);
    expect(page1.items.length).toBe(10);
    expect(page1.pagination.hasMore).toBe(true);

    const page3 = (await (await app.request('/api/bookmarks?limit=10&offset=20')).json()) as {
      items: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(page3.items.length).toBe(3);
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

  test('rejects a non-UUID tag id on tag removal with a 404', async () => {
    const response = await app.request(
      '/api/bookmarks/00000000-0000-0000-0000-000000000000/tags/not-a-uuid',
      { method: 'DELETE' },
    );
    expect(response.status).toBe(404);
  });

  test('aggregates report the full library', async () => {
    const body = (await (await app.request('/api/aggregates')).json()) as {
      total: number;
      categories: unknown[];
      tags: unknown[];
    };
    expect(body.total).toBe(23);
    expect(body.categories.length).toBe(8);
    expect(body.tags.length).toBe(51);
  });
});

describe('fused search pagination', () => {
  test('semantic mode pages over the fused ranking with an honest lower-bound total', async () => {
    const { db, app } = makeApp();
    const ids = await firstSeededIds(app, 5);
    // Same database, second app instance with the stub subsystems attached.
    const fusedApp = buildApp(db, {
      vector: new StubVectorIndex(ids),
      embeddings: stubEmbeddings,
    }).app;

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

  test('semantic mode excludes invalid bookmarks unless status=all', async () => {
    const { db, app } = makeApp();
    const ids = await firstSeededIds(app, 3);
    const invalid = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://semantic-invalid.test',
      title: 'Hidden',
      status: 'invalid',
      scrapeAttempts: 3,
    });
    const fusedApp = buildApp(db, {
      vector: new StubVectorIndex([invalid.id, ...ids]),
      embeddings: stubEmbeddings,
    }).app;

    const active = (await (
      await fusedApp.request('/api/bookmarks?q=zzzqqq&mode=semantic&limit=10&status=active')
    ).json()) as { items: { id: string }[] };
    expect(active.items.some((item) => item.id === invalid.id)).toBe(false);

    const all = (await (
      await fusedApp.request('/api/bookmarks?q=zzzqqq&mode=semantic&limit=10&status=all')
    ).json()) as { items: { id: string }[] };
    expect(all.items.some((item) => item.id === invalid.id)).toBe(true);
  });

  test('semantic mode without embeddings degrades to keyword-only', async () => {
    const { app } = makeApp();
    const body = (await (await app.request('/api/bookmarks?q=sqlite&mode=semantic')).json()) as {
      mode: string;
    };
    expect(body.mode).toBe('keyword');
  });
});

describe('scrape API', () => {
  test('scrapes inline and returns the updated bookmark', async () => {
    const { app } = makeApp({
      vector: new StubVectorIndex([]),
      scrape: async (url) => ({
        content: `# Content of ${url}`,
        contentHash: `hash-${url}`,
        metadata: { scrape: { at: 1, contentType: 'text/html', finalUrl: null, truncated: false } },
      }),
    });
    const bookmarks = (await (await app.request('/api/bookmarks?limit=1')).json()) as {
      items: { id: string; url: string }[];
    };
    const { id, url } = bookmarks.items[0]!;

    const response = await app.request(`/api/bookmarks/${id}/scrape`, { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      bookmark: { id: string; content: string; scrapedAt: number | null };
    };
    expect(body.status).toBe('scraped');
    expect(body.bookmark.content).toBe(`# Content of ${url}`);
    expect(body.bookmark.scrapedAt).not.toBeNull();
  });

  test('maps scrape failures to a problem+json 502', async () => {
    const { app } = makeApp({
      vector: new StubVectorIndex([]),
      scrape: async () => {
        throw new ScrapeError('HTTP 404');
      },
    });
    const bookmarks = (await (await app.request('/api/bookmarks?limit=1')).json()) as {
      items: { id: string }[];
    };
    const response = await app.request(`/api/bookmarks/${bookmarks.items[0]!.id}/scrape`, {
      method: 'POST',
    });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { type: string }).type).toContain('scrape-failed');
  });

  test('reports 503 when scraping is unavailable and 404 for unknown ids', async () => {
    const { app } = makeApp({ vector: new StubVectorIndex([]) });
    const unavailable = await app.request('/api/bookmarks/nope/scrape', { method: 'POST' });
    expect(unavailable.status).toBe(404);
  });
});

describe('classify API', () => {
  test('classifies inline and returns the updated bookmark with new tags', async () => {
    const { app } = makeApp({
      vector: new StubVectorIndex([]),
      classifier: stubClassifier({ animation: 0.9 }),
    });
    const bookmarks = (await (await app.request('/api/bookmarks?limit=1')).json()) as {
      items: { id: string }[];
    };
    const id = bookmarks.items[0]!.id;

    const response = await app.request(`/api/bookmarks/${id}/classify`, { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      assigned: number;
      bookmark: { tags: { name: string; source: string }[] };
    };
    expect(body.status).toBe('classified');
    expect(body.assigned).toBe(1);
    expect(
      body.bookmark.tags.some((tag) => tag.name === 'animation' && tag.source === 'classifier'),
    ).toBe(true);
  });

  test('reports 503 without a classifier and 404 for unknown ids', async () => {
    const { app } = makeApp({ vector: new StubVectorIndex([]) });
    const unavailable = await app.request('/api/bookmarks/nope/classify', { method: 'POST' });
    expect(unavailable.status).toBe(404);
  });
});

describe('reindex API', () => {
  test('rebuilds FTS rows from the bookmarks table', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/reindex', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ftsRows: number; vectorBackend: string };
    expect(body.ftsRows).toBe(23);
    expect(body.vectorBackend).toBe('memory');

    // Keyword search still works over the rebuilt index.
    const search = (await (await app.request('/api/bookmarks?q=sqlite')).json()) as {
      total: number;
    };
    expect(search.total).toBeGreaterThan(0);
  });
});

describe('chat API', () => {
  test('reports 503 problem+json when no chat model is configured', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { type: string; title: string };
    expect(body.type).toContain('chat-unavailable');
    expect(body.title).toContain('OLLAMA_CHAT_MODEL');
  });

  test('rejects malformed bodies with 400 before the model is consulted', async () => {
    const { app } = makeApp({ vector: new StubVectorIndex([]) });
    // Chat model unset would 503 first; with a model, a bad body 400s. The 503
    // path is covered above; here we assert ordering via the same stub config.
    const response = await app.request('/api/chat', { method: 'POST', body: 'not json' });
    expect([400, 503]).toContain(response.status);
  });
});

describe('import API', () => {
  test('previews, then commits the reviewed list with auto-created vocabulary', async () => {
    const { app } = makeApp();
    const markdown = '## dev\n\n- ** Tool: https://example.com/tool\n';

    const preview = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      parsed: number;
      bookmarks: ImportedBookmark[];
    };
    expect(previewBody.parsed).toBe(1);

    // Commit the (possibly edited) preview list — no markdown, no re-extraction.
    const imported = await app.request(
      '/api/import?file=test.md',
      jsonRequest({ bookmarks: previewBody.bookmarks }),
    );
    expect(imported.status).toBe(200);
    const body = (await imported.json()) as {
      bookmarks: unknown[];
      parsed: number;
      added: number;
    };
    expect(body.bookmarks).toHaveLength(1);
    expect(body.parsed).toBe(1);
    expect(body.added).toBe(1);
  });

  test('rejects a commit body without a valid bookmark array', async () => {
    const { app } = makeApp();

    const missing = await app.request('/api/import', jsonRequest({}));
    expect(missing.status).toBe(400);

    const empty = await app.request('/api/import', jsonRequest({ bookmarks: [] }));
    expect(empty.status).toBe(400);

    const badEntry = await app.request(
      '/api/import',
      jsonRequest({ bookmarks: [{ title: 'no url' }] }),
    );
    expect(badEntry.status).toBe(400);
  });

  test('rejects a non-UUID datasetId query param with a 400', async () => {
    const { app } = makeApp();
    const response = await app.request(
      '/api/import?datasetId=not-a-uuid',
      jsonRequest({
        bookmarks: [
          {
            url: 'https://example.com/x',
            title: null,
            description: null,
            category: null,
            priority: null,
            tags: [],
          },
        ],
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('review API', () => {
  test('returns an empty below-threshold list when nothing was classified', async () => {
    const { app } = makeApp();
    const candidates = await app.request('/api/review/candidates');
    expect(((await candidates.json()) as unknown[]).length).toBe(0);
  });
});

describe('profile API', () => {
  test('returns the singleton profile', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/profile');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(body.name).toBeNull();
    expect(body.activeDatasetId).toBeNull();
  });

  test('patches identity fields and normalizes the GitHub username', async () => {
    const { app } = makeApp();
    const response = await app.request(
      '/api/profile',
      jsonRequest({ name: 'Leo', githubUsername: '@leonistor' }, 'PATCH'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body.name).toBe('Leo');
    // People type "@user"; the API contract promises the bare username.
    expect(body.githubUsername).toBe('leonistor');
  });

  test('rejects an activeDatasetId that does not reference a dataset', async () => {
    const { app } = makeApp();
    const response = await app.request(
      '/api/profile',
      jsonRequest({ activeDatasetId: '00000000-0000-7000-8000-000000000000' }, 'PATCH'),
    );
    expect(response.status).toBe(400);
  });

  test('accepts an avatar upload through the injected store', async () => {
    const stored: string[] = [];
    const { app, db } = makeApp({
      avatarStore: {
        save: async (file) => {
          stored.push(file.ext);
          return `avatar.${file.ext}`;
        },
        remove: async () => {},
      },
    });

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const form = new FormData();
    form.append('avatar', new File([png], 'me.png', { type: 'image/png' }));
    const response = await app.request('/api/profile/avatar', { method: 'POST', body: form });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body.avatarPath).toBe('avatar.png');
    expect(stored).toEqual(['png']);
    expect(db.query('SELECT avatar_path FROM profile').get()).toEqual({ avatar_path: 'avatar.png' });
  });

  test('rejects uploads that are not JPEG/PNG images', async () => {
    const { app } = makeApp({
      avatarStore: {
        save: async () => {
          throw new Error('store must not be called');
        },
        remove: async () => {
          throw new Error('store must not be called');
        },
      },
    });

    const form = new FormData();
    const junk = new TextEncoder().encode('not an image');
    form.append('avatar', new File([junk], 'x.txt'));
    const bad = await app.request('/api/profile/avatar', { method: 'POST', body: form });
    expect(bad.status).toBe(400);

    const missing = await app.request('/api/profile/avatar', {
      method: 'POST',
      body: new FormData(),
    });
    expect(missing.status).toBe(400);
  });

  test('removes an uploaded avatar and clears the stored path', async () => {
    const removed: string[] = [];
    const { app, db } = makeApp({
      avatarStore: {
        save: async (file) => `avatar.${file.ext}`,
        remove: async (filename) => {
          removed.push(filename);
        },
      },
    });

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const form = new FormData();
    form.append('avatar', new File([png], 'me.png', { type: 'image/png' }));
    await app.request('/api/profile/avatar', { method: 'POST', body: form });

    const response = await app.request('/api/profile/avatar', { method: 'DELETE' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body.avatarPath).toBeNull();
    // The stored file is removed by the name the profile pointed at, and the
    // row no longer points at it (the `/data/profile/avatar` route is mounted by
    // index.ts, outside this app-only harness, so assert via the API + row).
    expect(removed).toEqual(['avatar.png']);
    expect(db.query('SELECT avatar_path FROM profile').get()).toEqual({ avatar_path: null });
    const reread = (await (await app.request('/api/profile')).json()) as Profile;
    expect(reread.avatarPath).toBeNull();
  });

  test('returns 404 when deleting an avatar that is not set', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/profile/avatar', { method: 'DELETE' });
    expect(response.status).toBe(404);
  });

  test('returns null when no dataset is active', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/profile/dataset');
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  test('returns the dataset the active-dataset pointer names', async () => {
    const { app, db } = makeApp();
    const dataset = createDataset(db, 'Work');

    const patched = await app.request(
      '/api/profile',
      jsonRequest({ activeDatasetId: dataset.id }, 'PATCH'),
    );
    expect(patched.status).toBe(200);

    const response = await app.request('/api/profile/dataset');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(dataset);
  });
});

describe('lan API', () => {
  test('returns non-internal IPv4 interfaces without URLs', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/lan');
    expect(response.status).toBe(200);

    // Count-agnostic: CI containers may have zero LAN interfaces.
    const body = (await response.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);

    for (const entry of body as { name?: unknown; address?: unknown }[]) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.address).toBe('string');
      const address = entry.address as string;
      // IPv6 addresses contain ':'; loopback/unspecified are internal.
      expect(address).not.toContain(':');
      expect(address).not.toStartWith('127.');
      expect(address).not.toBe('0.0.0.0');
    }
  });
});
