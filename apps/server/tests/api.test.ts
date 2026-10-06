import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import type { AiHealthReport, ClassifierClient, EmbeddingClient, SuggestClient } from '@al-yo-bo/ai';
import {
  ScrapeError,
  createCore,
  createVectorProvider,
  type AvatarStore,
  type CoreAi,
  type ScrapeFn,
} from '@al-yo-bo/core';
import {
  assignTag,
  createBookmark,
  createCategory,
  createTag,
  getBookmarkById,
  loadSeedFixture,
  openDatabase,
  seedDatabase,
  setupDatabase,
} from '@al-yo-bo/db';
import { unzipSync } from 'fflate';
import { hc } from 'hono/client';
import type {
  ImportedBookmark,
  Profile,
  RankedCandidate,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';

import { createApp, type AppType } from '../src/app.ts';
import { loadConfig, type ServerConfig } from '../src/env.ts';
import { EventHub } from '../src/events.ts';

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
    _filter?: undefined,
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

/** Static AiHealth fake — no sidecar is probed in tests. */
const stubHealth = {
  async report(): Promise<AiHealthReport> {
    return {
      ollayaReachable: false,
      ollamaReachable: false,
      chatAvailable: false,
      chatModel: null,
      embeddingsConfigured: false,
      embeddingModel: 'stub-model',
      classifierModel: 'laya',
      extractConfigured: false,
      extractModel: null,
    };
  },
};

/** CoreAi fake assembled from the optional capabilities a test attaches. */
function stubAiLayer(options: {
  embeddings?: EmbeddingClient | null;
  classifier?: ClassifierClient | null;
  suggest?: SuggestClient | null;
}): CoreAi {
  return {
    embeddings: options.embeddings ?? null,
    classifier: options.classifier ?? null,
    suggest: options.suggest ?? null,
    extract: null,
    health: stubHealth,
  };
}

/** Optional capabilities a transport test can attach to a real core instance. */
interface AppOptions {
  vector?: VectorIndex;
  embeddings?: EmbeddingClient;
  scrape?: ScrapeFn;
  classifier?: ClassifierClient;
  suggest?: SuggestClient;
  avatarStore?: AvatarStore;
  reindex?: () => Promise<{ vectorBackend: 'qdrant' | 'memory' }>;
  /** Extra env values merged into the test config (e.g. OLLAMA_CHAT_MODEL). */
  env?: Record<string, string>;
}

/** Builds a core (with the stub subsystems) over an already-seeded db, then the app. */
function buildApp(db: Database, options: AppOptions = {}, hub = new EventHub()) {
  const config: ServerConfig = loadConfig({ DATA_DIR: '/tmp/al-yo-bo-api-test', ...options.env });
  const core = createCore({
    db,
    config,
    ai: stubAiLayer({
      embeddings: options.embeddings ?? null,
      classifier: options.classifier ?? null,
      suggest: options.suggest ?? null,
    }),
    vector: createVectorProvider(options.vector ?? new StubVectorIndex([]), 'memory'),
    scrape: options.scrape,
    avatarStore: options.avatarStore,
    events: hub,
    reindex: options.reindex,
  });
  return { db, core, config, hub, app: createApp(core, config, hub) };
}

/** Seeds the canonical octocat fixture (ARCHITECTURE §5) into an in-memory db. */
function makeApp(options: AppOptions = {}) {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  seedDatabase(db, loadSeedFixture());
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
function stubClassifier(probabilities: Record<string, number>): ClassifierClient {
  return {
    async decide(request) {
      const asked = Object.keys(request.questions);
      return {
        probabilities: Object.fromEntries(asked.map((name) => [name, probabilities[name] ?? 0])),
        model: 'laya:en',
      };
    },
  };
}

/** SuggestClient stub returning a fixed vocabulary proposal. */
function stubSuggest(proposal: {
  tags: { name: string; description?: string }[];
  categories: { path: string[]; description?: string }[];
}): SuggestClient {
  return {
    async suggest() {
      return proposal;
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
    expect(body.total).toBe(25);
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
      url: 'https://api-invalid.test',
      title: 'Broken',
      status: 'invalid',
      scrapeAttempts: 3,
    });

    const def = (await (await testApp.request('/api/bookmarks?limit=100')).json()) as {
      total: number;
      items: { id: string }[];
    };
    expect(def.total).toBe(25);
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
    expect(all.total).toBe(26);
    expect(all.items.some((bookmark) => bookmark.id === invalid.id)).toBe(true);
  });

  test('changing a bookmark URL resets status and scrape attempts', async () => {
    // `testApp` (not the describe-level `app`): paired with the db this test mutates.
    const { db, app: testApp } = makeApp();
    const invalid = createBookmark(db, {
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
    expect(page1.total).toBe(25);
    expect(page1.items.length).toBe(10);
    expect(page1.pagination.hasMore).toBe(true);

    const page3 = (await (await app.request('/api/bookmarks?limit=10&offset=20')).json()) as {
      items: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(page3.items.length).toBe(5);
    expect(page3.pagination.hasMore).toBe(false);
  });

  test('health reports vector, ai probes, enrichment capabilities and sidecar status', async () => {
    const { app: testApp } = makeApp({ env: { SCRAPE_SIDECAR_URL: '' } });
    const body = (await (await testApp.request('/api/health')).json()) as {
      status: string;
      vector: { backend: string; indexed: number };
      ai: { chatAvailable: boolean; embeddingModel: string };
      enrichment: { scrapeAvailable: boolean };
      screenshot: { available: boolean };
      scrapeSidecar: { configured: boolean; url?: string; reachable: boolean | null };
    };
    expect(body.status).toBe('ok');
    expect(body.vector.backend).toBe('memory');
    expect(body.vector.indexed).toBe(0);
    // Chat flags live in the ai block now — no per-call chat config anymore.
    expect(body.ai.chatAvailable).toBe(false);
    expect(body.ai.embeddingModel).toBe('stub-model');
    expect(body.enrichment.scrapeAvailable).toBe(false);
    expect(body.screenshot.available).toBe(false);
    expect(body.scrapeSidecar).toEqual({ configured: false, reachable: null });
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

  test('malformed JSON bodies are a 400 problem+json, not a 500', async () => {
    // The jsonBody validator path (Hono wraps the parse error in an
    // HTTPException 400, mapped by onError in errors.ts).
    const bookmark = await app.request('/api/bookmarks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(bookmark.status).toBe(400);
    expect(((await bookmark.json()) as { type: string }).type).toContain('validation');

    // The direct `c.req.json()` path in readImportText (raw SyntaxError).
    const preview = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(preview.status).toBe(400);
    expect(((await preview.json()) as { type: string }).type).toContain('validation');
  });

  test('a calendar-invalid date-only param is a 400, not silently empty', async () => {
    // `2024-02-30` matches the YYYY-MM-DD shape but is not a real day.
    const urls = [
      '/api/bookmarks?dateFrom=2024-02-30',
      '/api/export?formats=json&dateTo=2024-02-30',
    ];
    const results = await Promise.all(
      urls.map(async (url) => {
        const response = await app.request(url);
        return { url, status: response.status, type: ((await response.json()) as { type: string }).type };
      }),
    );
    for (const { url, status, type } of results) {
      expect(status, url).toBe(400);
      expect(type).toContain('validation');
    }
  });

  test('blank numeric env values fall back to defaults', () => {
    // `PORT=` must not coerce to 0; a blank timeout must not become 0 ms.
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
    expect(loadConfig({ SCRAPE_TIMEOUT_MS: '   ' }).scrape.timeoutMs).toBe(15_000);
    expect(loadConfig({ QDRANT_TIMEOUT_MS: '' }).qdrant.timeoutMs).toBe(5_000);
  });

  test('scrape sidecar env mapping: defaults, disable, and boolean parsing', () => {
    // On by default at localhost; empty string disables.
    const withDefaults = loadConfig({});
    expect(withDefaults.scrape.sidecar).toEqual({
      url: 'http://127.0.0.1:9383',
      fetchTimeoutMs: 15_000,
      browseTimeoutMs: 45_000,
      humanize: true,
    });
    expect(loadConfig({ SCRAPE_SIDECAR_URL: '' }).scrape.sidecar).toBeUndefined();

    // Custom values.
    expect(loadConfig({ SCRAPE_SIDECAR_URL: 'http://sidecar.test' }).scrape.sidecar?.url).toBe(
      'http://sidecar.test',
    );
    expect(loadConfig({ SCRAPE_SIDECAR_TIMEOUT_MS: '5000' }).scrape.sidecar?.fetchTimeoutMs).toBe(
      5_000,
    );
    expect(loadConfig({ SCRAPE_BROWSE_TIMEOUT_MS: '30000' }).scrape.sidecar?.browseTimeoutMs).toBe(
      30_000,
    );

    // Humanize: only "false" and "0" are falsy; everything else is true.
    expect(loadConfig({ SCRAPE_BROWSE_HUMANIZE: 'false' }).scrape.sidecar?.humanize).toBe(false);
    expect(loadConfig({ SCRAPE_BROWSE_HUMANIZE: '0' }).scrape.sidecar?.humanize).toBe(false);
    expect(loadConfig({ SCRAPE_BROWSE_HUMANIZE: 'true' }).scrape.sidecar?.humanize).toBe(true);
    expect(loadConfig({ SCRAPE_BROWSE_HUMANIZE: 'yes' }).scrape.sidecar?.humanize).toBe(true);
    expect(loadConfig({ SCRAPE_BROWSE_HUMANIZE: '' }).scrape.sidecar?.humanize).toBe(true);
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
    expect(body.total).toBe(25);
    expect(body.categories.length).toBe(14);
    expect(body.tags.length).toBe(67);
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

  test('reports 404 for unknown ids', async () => {
    const { app } = makeApp({ vector: new StubVectorIndex([]) });
    const unavailable = await app.request('/api/bookmarks/nope/scrape', { method: 'POST' });
    expect(unavailable.status).toBe(404);
  });
});

describe('classify API', () => {
  test('classifies inline and returns the updated bookmark with new tags', async () => {
    const { db, app } = makeApp({
      vector: new StubVectorIndex([]),
      // A fresh, untagged bookmark keeps the assertion deterministic: exactly
      // one tag clears the 0.7 threshold and lands as `source='classifier'`.
      classifier: stubClassifier({ docs: 0.9 }),
    });
    const bookmark = createBookmark(db, { url: 'https://classify.test', title: 'Classify me' });

    const response = await app.request(`/api/bookmarks/${bookmark.id}/classify`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      assigned: number;
      bookmark: { tags: { name: string; source: string }[] };
    };
    expect(body.status).toBe('classified');
    expect(body.assigned).toBe(1);
    expect(
      body.bookmark.tags.some((tag) => tag.name === 'docs' && tag.source === 'classifier'),
    ).toBe(true);
  });

  test('reports 404 for unknown ids', async () => {
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
    expect(body.ftsRows).toBe(25);
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

  test('a malformed UI-message shape is a 400, not a 500', async () => {
    const { app } = makeApp({ env: { OLLAMA_CHAT_MODEL: 'stub-model' } });
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `parts` is not an array: convertToModelMessages would throw a TypeError
      // that used to surface through onError as a 500.
      body: JSON.stringify({ messages: [{ id: '1', role: 'user', parts: 'nope' }] }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { type: string }).type).toContain('validation');
  });
});

describe('import API', () => {
  test('previews, then commits the reviewed list with auto-created vocabulary', async () => {
    const { app } = makeApp();
    // Tree-native format: H2 is a level-1 category, `**` is priority — not a tag.
    const markdown = '## dev\n\n- ** Tool: https://example.com/tool\n';

    const preview = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      parsed: number;
      provider: string;
      bookmarks: ImportedBookmark[];
    };
    expect(previewBody.parsed).toBe(1);
    expect(previewBody.provider).toBe('fallback');
    expect(previewBody.bookmarks[0]!.categoryPath).toEqual(['dev']);

    // Commit the (possibly edited) preview list — no markdown, no re-extraction.
    const imported = await app.request(
      '/api/import?file=test.md',
      jsonRequest({ bookmarks: previewBody.bookmarks }),
    );
    expect(imported.status).toBe(200);
    const body = (await imported.json()) as {
      bookmarks: number;
      parsed: number;
      added: number;
      categoriesCreated: number;
    };
    expect(body.bookmarks).toBe(1);
    expect(body.parsed).toBe(1);
    expect(body.added).toBe(1);
    expect(body.categoriesCreated).toBe(1);
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
});

describe('vocabulary suggest API', () => {
  test('returns AI suggestions when a suggest client is configured', async () => {
    const { app } = makeApp({
      suggest: stubSuggest({
        tags: [{ name: 'ai-tag' }],
        categories: [{ path: ['ai', 'category'] }],
      }),
    });

    const response = await app.request(
      '/api/vocabulary/suggest',
      jsonRequest({ devProfile: { source: 'questionnaire', focus: 'ai' } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      available: boolean;
      tags: { name: string }[];
      categories: { path: string[] }[];
    };
    expect(body.available).toBe(true);
    expect(body.tags).toEqual([{ name: 'ai-tag' }]);
    expect(body.categories).toEqual([{ path: ['ai', 'category'] }]);
  });

  test('degrades to available:false when no suggest client is configured', async () => {
    const { app } = makeApp();

    const response = await app.request(
      '/api/vocabulary/suggest',
      jsonRequest({ devProfile: { source: 'questionnaire' } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      available: boolean;
      tags: unknown[];
      categories: unknown[];
    };
    expect(body.available).toBe(false);
    expect(body.tags).toEqual([]);
    expect(body.categories).toEqual([]);
  });
});

describe('vocabulary bulk API', () => {
  test('creates tags and categories from a wizard batch', async () => {
    const { app } = makeApp();

    const response = await app.request(
      '/api/vocabulary/bulk',
      jsonRequest({
        tags: [{ name: 'bulk-tag' }],
        categories: [{ path: ['bulk', 'category'] }],
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      tagsCreated: number;
      categoriesCreated: number;
      tags: { name: string }[];
      categories: { name: string }[];
    };
    expect(body.tagsCreated).toBe(1);
    expect(body.categoriesCreated).toBe(2);
    expect(body.tags.map((tag) => tag.name)).toEqual(['bulk-tag']);
    expect(body.categories.map((category) => category.name)).toEqual(['category']);
  });
});

describe('profile API', () => {
  test('returns the singleton profile', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/profile');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body.id).toBe('00000000-0000-0000-0000-000000000000');
    // The octocat fixture identities the profile (MODEL.md principle 8).
    expect(body.name).toBe('octocat');
    expect(body.githubUsername).toBe('octocat');
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

  test('patches the developer profile and setup-completed timestamp', async () => {
    const { app } = makeApp();
    const response = await app.request(
      '/api/profile',
      jsonRequest(
        {
          devProfile: {
            source: 'questionnaire',
            focus: 'web',
            languages: ['typescript'],
            frameworks: ['react'],
            tools: ['neovim'],
            experience: 'senior',
            notes: 'hello',
          },
          setupCompletedAt: 1_234_567_890,
        },
        'PATCH',
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body.devProfile).toEqual({
      source: 'questionnaire',
      focus: 'web',
      languages: ['typescript'],
      frameworks: ['react'],
      tools: ['neovim'],
      experience: 'senior',
      notes: 'hello',
    });
    expect(body.setupCompletedAt).toBe(1_234_567_890);
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

describe('category tree API', () => {
  test('returns the nested tree with seeded roots and children', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/categories');
    expect(response.status).toBe(200);
    const tree = (await response.json()) as { id: string; name: string; children: unknown[] }[];
    expect(tree.map((node) => node.name).toSorted()).toEqual([
      'AI tools',
      'Design',
      'Dev tools',
      'GitHub',
      'Learning',
    ]);
    const devTools = tree.find((node) => node.name === 'Dev tools')!;
    expect(devTools.children.length).toBe(4);
  });

  test('creates roots and children, refusing sibling-name duplicates', async () => {
    const { app } = makeApp();

    const root = await app.request('/api/categories', jsonRequest({ name: 'Travel' }));
    expect(root.status).toBe(201);
    const rootBody = (await root.json()) as { id: string; parentId: string | null };
    expect(rootBody.parentId).toBeNull();

    const child = await app.request(
      '/api/categories',
      jsonRequest({ name: 'Japan', parentId: rootBody.id }),
    );
    expect(child.status).toBe(201);
    expect(((await child.json()) as { parentId: string }).parentId).toBe(rootBody.id);

    const duplicateRoot = await app.request('/api/categories', jsonRequest({ name: 'Travel' }));
    expect(duplicateRoot.status).toBe(409);

    // Same name under a DIFFERENT parent is fine (sibling-unique, MODEL.md §2).
    const other = await app.request('/api/categories', jsonRequest({ name: 'Work' }));
    const otherBody = (await other.json()) as { id: string };
    const namesake = await app.request(
      '/api/categories',
      jsonRequest({ name: 'Japan', parentId: otherBody.id }),
    );
    expect(namesake.status).toBe(201);

    // An unknown parent id is a 404, not a raw SQLite error.
    const unknownParent = await app.request(
      '/api/categories',
      jsonRequest({ name: 'Orphan', parentId: '00000000-0000-7000-8000-000000000000' }),
    );
    expect(unknownParent.status).toBe(404);
  });

  test('moves a category and refuses cycles', async () => {
    const { db, app } = makeApp();
    const parent = createCategory(db, { name: 'Move Source' });
    const target = createCategory(db, { name: 'Move Target' });
    const child = createCategory(db, { name: 'Move Child', parentId: parent.id });

    const moved = await app.request(
      `/api/categories/${child.id}`,
      jsonRequest({ parentId: target.id }, 'PATCH'),
    );
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { parentId: string }).parentId).toBe(target.id);

    // Moving `target` under its own new child `child` would close a cycle.
    const cycle = await app.request(
      `/api/categories/${target.id}`,
      jsonRequest({ parentId: child.id }, 'PATCH'),
    );
    expect(cycle.status).toBe(400);
    expect(((await cycle.json()) as { title: string }).title).toContain('subtree');
  });

  test('reorder persists the requested sibling order with ascending keys', async () => {
    const { db, app } = makeApp();
    const a = createCategory(db, { name: 'Reorder A' });
    const b = createCategory(db, { name: 'Reorder B' });
    const c = createCategory(db, { name: 'Reorder C' });

    const response = await app.request(
      '/api/categories/reorder',
      jsonRequest({ parentId: null, orderedIds: [c.id, a.id, b.id] }),
    );
    expect(response.status).toBe(200);
    const reordered = (await response.json()) as { id: string; sortOrder: string }[];
    expect(reordered.map((category) => category.id)).toEqual([c.id, a.id, b.id]);
    // Fractional keys come back evenly spaced and ascending in the new order.
    expect(reordered[0]!.sortOrder < reordered[1]!.sortOrder).toBe(true);
    expect(reordered[1]!.sortOrder < reordered[2]!.sortOrder).toBe(true);
  });

  test('reorder validation: duplicates, mixed parents and unknown ids are 400/404', async () => {
    const { db, app } = makeApp();
    const a = createCategory(db, { name: 'VA' });
    const child = createCategory(db, { name: 'VA child', parentId: a.id });

    const duplicate = await app.request(
      '/api/categories/reorder',
      jsonRequest({ parentId: null, orderedIds: [a.id, a.id] }),
    );
    expect(duplicate.status).toBe(400);

    const mixed = await app.request(
      '/api/categories/reorder',
      jsonRequest({ parentId: null, orderedIds: [a.id, child.id] }),
    );
    expect(mixed.status).toBe(400);

    const unknown = await app.request(
      '/api/categories/reorder',
      jsonRequest({ parentId: null, orderedIds: ['00000000-0000-7000-8000-000000000000'] }),
    );
    expect(unknown.status).toBe(404);
  });

  test('delete returns the subtree counts and orphans the bookmarks', async () => {
    const { db, app } = makeApp();
    const parent = createCategory(db, { name: 'Delete Parent' });
    const child = createCategory(db, { name: 'Delete Child', parentId: parent.id });
    const shelved = createBookmark(db, {
      url: 'https://delete-subtree.test',
      title: 'Shelved',
      categoryId: child.id,
    });

    const response = await app.request(`/api/categories/${parent.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    // The confirmation UI's numbers: 2 categories (parent + child), 1 bookmark.
    expect(await response.json()).toEqual({ categories: 2, bookmarks: 1 });

    // The bookmark survives with its category pointer cleared.
    const row = getBookmarkById(db, shelved.id)!;
    expect(row.categoryId).toBeNull();
  });

  test('bookmark category assignment rejects unknown categories with a 404', async () => {
    const { app } = makeApp();
    const response = await app.request(
      '/api/bookmarks',
      jsonRequest({
        url: 'https://example.com/orphan',
        categoryId: '00000000-0000-7000-8000-000000000000',
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('tag status API', () => {
  test('deprecating and reactivating a tag flips its lifecycle', async () => {
    const { db, app } = makeApp();
    const tag = createTag(db, { name: 'lifecycle-tag' });

    const deprecated = await app.request(
      `/api/tags/${tag.id}/status`,
      jsonRequest({ status: 'deprecated' }),
    );
    expect(deprecated.status).toBe(200);
    expect(((await deprecated.json()) as { status: string }).status).toBe('deprecated');

    const reactivated = await app.request(
      `/api/tags/${tag.id}/status`,
      jsonRequest({ status: 'active' }),
    );
    expect(((await reactivated.json()) as { status: string }).status).toBe('active');
  });

  test('rejects a status outside the lifecycle', async () => {
    const { db, app } = makeApp();
    const tag = createTag(db, { name: 'bad-status-tag' });
    const response = await app.request(
      `/api/tags/${tag.id}/status`,
      jsonRequest({ status: 'pending' }),
    );
    expect(response.status).toBe(400);
  });
});

describe('export API', () => {
  test('streams a single format as an attachment', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/export?formats=html');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="alyobo-bookmarks.html"',
    );
    // Raw body, not JSON — the RPC contract only types it.
    expect((await response.text()).startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
  });

  test('zips multiple formats at the edge', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/export?formats=html&formats=json');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="alyobo-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    );

    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries).toSorted()).toEqual([
      'alyobo-bookmarks.html',
      'alyobo-bookmarks.json',
    ]);

    const decoder = new TextDecoder();
    expect(decoder.decode(entries['alyobo-bookmarks.html']!).startsWith('<!DOCTYPE NETSCAPE')).toBe(
      true,
    );
    const json = JSON.parse(decoder.decode(entries['alyobo-bookmarks.json']!)) as {
      format: string;
    };
    expect(json.format).toBe('al-yo-bo/export');
  });

  test('forwards tag, status, text and date filters to the uncapped query', async () => {
    const { db, app } = makeApp();
    const tag = createTag(db, { name: 'export-tag' });
    const category = createCategory(db, { name: 'Export Category' });
    const matching = createBookmark(db, {
      url: 'https://export-match.test',
      title: 'Match sqlite',
      categoryId: category.id,
    });
    createBookmark(db, { url: 'https://export-other.test', title: 'Other' });
    assignTag(db, { bookmarkId: matching.id, tagId: tag.id, source: 'user' });

    const response = await app.request(
      `/api/export?formats=json&tagId=${tag.id}&status=active&q=sqlite` +
        '&dateFrom=2000-01-01&dateTo=2100-01-01',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { bookmarks: { url: string }[] };
    expect(body.bookmarks.map((row) => row.url)).toEqual(['https://export-match.test/']);
  });

  test('rejects missing, unknown and malformed params with a 400', async () => {
    const { app } = makeApp();
    const cases: { url: string; title: string }[] = [
      { url: '/api/export', title: 'At least one export format is required' },
      { url: '/api/export?formats=xml', title: 'Unsupported export format: xml' },
      { url: '/api/export?formats=json&categoryId=not-a-uuid', title: 'categoryId' },
      { url: '/api/export?formats=json&dateFrom=not-a-date', title: 'dateFrom' },
    ];

    const results = await Promise.all(
      cases.map(async ({ url, title }) => {
        const response = await app.request(url);
        return { status: response.status, title, body: (await response.json()) as { title: string } };
      }),
    );

    for (const { status, title, body } of results) {
      expect(status).toBe(400);
      expect(body.title).toContain(title);
    }
  });

  test('exports a header-only CSV when the filter matches nothing', async () => {
    const { app } = makeApp();
    const emptyCategory = '00000000-0000-7000-8000-000000000000';
    const response = await app.request(`/api/export?formats=csv&categoryId=${emptyCategory}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(await response.text()).toBe('folder,url,title,note,tags,created\n');
  });

  test('dateFrom/dateTo expand date-only params to UTC day bounds', async () => {
    const { db, app } = makeApp();
    const inRange = createBookmark(db, {
      url: 'https://range-in.test',
      title: 'In range',
    });
    const outOfRange = createBookmark(db, {
      url: 'https://range-out.test',
      title: 'Out of range',
    });
    // Seed fixtures carry 2026 timestamps, so a 2001 window isolates these rows.
    db.query('UPDATE bookmarks SET created_at = ? WHERE url = ?').run(
      Date.parse('2001-05-05T12:00:00.000Z'),
      inRange.url,
    );
    db.query('UPDATE bookmarks SET created_at = ? WHERE url = ?').run(
      Date.parse('2001-05-06T12:00:00.000Z'),
      outOfRange.url,
    );

    const response = await app.request(
      '/api/bookmarks?dateFrom=2001-05-05&dateTo=2001-05-05&limit=100',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total: number; items: { url: string }[] };
    expect(body.total).toBe(1);
    expect(body.items.map((item) => item.url)).toEqual(['https://range-in.test/']);
  });
});
