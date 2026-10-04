import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  createCore,
  createVectorProvider,
  type CoreAi,
  type Core,
} from '@al-yo-bo/core';
import {
  loadSeedFixture,
  openDatabase,
  seedDatabase,
  setupDatabase,
} from '@al-yo-bo/db';
import type { VectorIndex } from '@al-yo-bo/shared';

import { createApp } from '../src/app.ts';
import { loadConfig, type ServerConfig } from '../src/env.ts';
import { EventHub } from '../src/events.ts';

/**
 * Bookmarks MCP surface tests (ARCHITECTURE §8). Same harness pattern as
 * api.test.ts — in-memory db seeded with the octocat fixture, real core, stub
 * sidecars — plus the official MCP TS SDK client talking streamable HTTP over
 * the Hono app's fetch (no network listener needed).
 */

/** Deterministic empty VectorIndex stub — MCP tools are read-only over search. */
class EmptyVectorIndex implements VectorIndex {
  get size(): number {
    return 0;
  }

  async upsert(): Promise<void> {}

  async updatePayload(): Promise<void> {}

  async delete(): Promise<void> {}

  async search(): Promise<never[]> {
    return [];
  }
}

/** Static AiHealth fake — no sidecar is probed in tests. */
const stubHealth = {
  async report() {
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

function stubAiLayer(): CoreAi {
  return { embeddings: null, classifier: null, extract: null, health: stubHealth };
}

interface McpAppOptions {
  env?: Record<string, string>;
}

/** Builds a real core over the seeded octocat fixture, then the full app. */
function makeApp(options: McpAppOptions = {}): { db: Database; core: Core; app: ReturnType<typeof createApp>; config: ServerConfig } {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  seedDatabase(db, loadSeedFixture());
  const config: ServerConfig = loadConfig({ DATA_DIR: '/tmp/al-yo-bo-mcp-test', ...options.env });
  const hub = new EventHub();
  const core = createCore({
    db,
    config,
    ai: stubAiLayer(),
    vector: createVectorProvider(new EmptyVectorIndex(), 'memory'),
    events: hub,
  });
  return { db, core, app: createApp(core, config, hub), config };
}

/** Connects an official SDK MCP client to the mounted endpoint via app.fetch. */
async function connectClient(app: ReturnType<typeof createApp>, token?: string): Promise<Client> {
  const client = new Client({ name: 'al-yo-bo-mcp-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    // Bridge the transport onto the Hono app — no network listener. Bun strips
    // the implicit Host header from a constructed Request (a fetch-spec
    // forbidden header) and the adapter's guard needs it, so re-derive it from
    // the target URL — exactly what a real HTTP client would have sent.
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      if (!headers.get('host')) {
        headers.set('host', new URL(url).host);
      }
      return await app.fetch(new Request(String(url), { ...init, headers, duplex: 'half' }));
    },
    ...(token !== undefined && {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  });
  await client.connect(transport);
  return client;
}

interface TextBlock {
  type: 'text';
  text: string;
}

function isTextBlock(block: unknown): block is TextBlock {
  if (typeof block !== 'object' || block === null || !('type' in block)) {
    return false;
  }
  const record = block as Record<string, unknown>;
  return record['type'] === 'text' && typeof record['text'] === 'string';
}

function firstText(content: readonly unknown[]): string {
  const block = content.find(isTextBlock);
  if (!block) {
    throw new Error('result carried no text block');
  }
  return block.text;
}

/** Calls a tool and parses its JSON text payload; tool-level errors fail loud. */
async function callToolJson<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`tool ${name} failed: ${firstText(result.content)}`);
  }
  return JSON.parse(firstText(result.content)) as T;
}

interface McpHit {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
}

describe('bookmarks MCP server', () => {
  let harness: ReturnType<typeof makeApp>;
  let client: Client;

  beforeEach(async () => {
    harness = makeApp();
    client = await connectClient(harness.app);
  });

  test('tools/list exposes exactly the four read-only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'get_bookmark',
      'list_categories',
      'list_tags',
      'search_bookmarks',
    ]);
    // Read-only posture advertised to clients (§8: no write tools).
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.description).toBeTruthy();
    }
  });

  test('search_bookmarks returns compact seeded hits with category paths and tag names', async () => {
    const hits = await callToolJson<McpHit[]>(client, 'search_bookmarks', { q: 'sqlite' });
    expect(hits.length).toBeGreaterThan(0);
    const sqlite = hits.find((hit) => hit.url === 'https://www.sqlite.org/');
    expect(sqlite).toBeDefined();
    expect(sqlite!.title).toContain('SQLite');
    // Category path from the seeded tree: `## Dev tools` → `### Databases`.
    expect(sqlite!.category).toBe('Dev tools / Databases');
    expect(sqlite!.tags).toContain('sql');
    // Compact projection only — never page content or internal fields.
    expect(Object.keys(sqlite!).toSorted()).toEqual(['category', 'description', 'id', 'tags', 'title', 'url']);
  });

  test('search_bookmarks caps limit at 20 and accepts the documented filters', async () => {
    await expect(
      callToolJson(client, 'search_bookmarks', { q: 'sqlite', limit: 21 }),
    ).rejects.toThrow();

    // tagId/categoryId filters reach the same core path the HTTP API uses.
    const tags = await callToolJson<{ id: string; name: string }[]>(client, 'list_tags', {});
    const sqlTag = tags.find((tag) => tag.name === 'sql')!;
    const byTag = await callToolJson<McpHit[]>(client, 'search_bookmarks', {
      q: 'database',
      tagId: sqlTag.id,
    });
    expect(byTag.length).toBeGreaterThan(0);
    expect(byTag.every((hit) => hit.tags.includes('sql'))).toBe(true);
  });

  test('get_bookmark round-trips a hit into the full record', async () => {
    const hits = await callToolJson<McpHit[]>(client, 'search_bookmarks', { q: 'sqlite' });
    const hit = hits.find((row) => row.url === 'https://www.sqlite.org/')!;

    const bookmark = await callToolJson<{
      id: string;
      url: string;
      title: string | null;
      status: string;
      tags: { name: string; source: string }[];
    }>(client, 'get_bookmark', { id: hit.id });

    expect(bookmark.id).toBe(hit.id);
    expect(bookmark.url).toBe('https://www.sqlite.org/');
    expect(bookmark.status).toBe('active');
    expect(bookmark.tags.some((tag) => tag.name === 'sql')).toBe(true);
  });

  test('get_bookmark reports a tool error for an unknown id', async () => {
    const result = await client.callTool({
      name: 'get_bookmark',
      arguments: { id: '00000000-0000-7000-8000-000000000000' },
    });
    expect(result.isError).toBe(true);
  });

  test('list_categories returns the nested tree with per-category counts', async () => {
    const tree = await callToolJson<
      { id: string; name: string; count: number; children: { name: string; count: number }[] }[]
    >(client, 'list_categories', {});

    expect(tree.map((node) => node.name).toSorted()).toEqual([
      'AI tools',
      'Design',
      'Dev tools',
      'GitHub',
      'Learning',
    ]);
    const devTools = tree.find((node) => node.name === 'Dev tools')!;
    expect(devTools.children.map((child) => child.name).toSorted()).toEqual([
      'Databases',
      'Editors',
      'Runtimes & frameworks',
      'UI components',
    ]);
    expect(devTools.children.find((child) => child.name === 'Databases')!.count).toBe(1);
  });

  test('list_tags lists the seeded vocabulary with lifecycle status', async () => {
    const tags = await callToolJson<{ id: string; name: string; status: string }[]>(client, 'list_tags', {});
    expect(tags.length).toBe(67);
    expect(tags.every((tag) => tag.status === 'active')).toBe(true);
    expect(tags.map((tag) => tag.name)).toContain('vector-search');
  });

  test('bookmark://{id} resource reads the record; the template lists the library', async () => {
    const hits = await callToolJson<McpHit[]>(client, 'search_bookmarks', { q: 'sqlite' });
    const hit = hits.find((row) => row.url === 'https://www.sqlite.org/')!;

    const read = await client.readResource({ uri: `bookmark://${hit.id}` });
    expect(read.contents.length).toBe(1);
    const contents = read.contents[0]!;
    expect(contents.uri).toBe(`bookmark://${hit.id}`);
    expect(contents.mimeType).toBe('application/json');
    if (!('text' in contents)) {
      throw new Error('expected a text resource');
    }
    const bookmark = JSON.parse(contents.text) as { id: string; url: string };
    expect(bookmark.id).toBe(hit.id);
    expect(bookmark.url).toBe('https://www.sqlite.org/');

    const { resources } = await client.listResources();
    expect(resources.length).toBe(25);
    expect(resources.some((resource) => resource.uri === `bookmark://${hit.id}`)).toBe(true);
  });

  test('reading a malformed resource URI reports the bookmark as missing, not a crash', async () => {
    const result = await client.readResource({ uri: 'bookmark://not-a-uuid' }).catch((error: Error) => {
      expect(error.message).not.toContain('codec');
      return null;
    });
    expect(result).toBeNull();
  });

  test('/api/health surfaces the MCP mount status', async () => {
    const loopback = (await (await harness.app.request('/api/health')).json()) as {
      mcp: { mounted: boolean; auth: string };
    };
    expect(loopback.mcp).toEqual({ mounted: true, auth: 'loopback' });

    const { app } = makeApp({ env: { MCP_TOKEN: 'health-token' } });
    const guarded = (await (await app.request('/api/health')).json()) as {
      mcp: { mounted: boolean; auth: string };
    };
    expect(guarded.mcp).toEqual({ mounted: true, auth: 'bearer' });
  });
});

describe('MCP token gate', () => {
  test('401s requests without the bearer token and admits requests with it', async () => {
    const { app } = makeApp({ env: { MCP_TOKEN: 'test-token' } });

    const init = {
      method: 'POST',
      headers: {
        Host: 'localhost:3000',
        'content-type': 'application/json',
        // JSON-only accept: with `text/event-stream` the transport answers the
        // initialize over SSE, which this raw probe would have to parse.
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw-probe', version: '0.0.0' },
        },
      }),
    };
    const denied = await app.request('http://localhost/mcp', init);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toBe('Bearer');
    expect(((await denied.json()) as { error: { code: number } }).error.code).toBe(-32_000);

    const admitted = await app.request('http://localhost/mcp', {
      ...init,
      headers: {
        ...init.headers,
        // The streamable-HTTP transport requires both types in Accept (MCP spec)
        // and may answer the initialize over either — handle both shapes.
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer test-token',
      },
    });
    expect(admitted.status).toBe(200);
    const contentType = admitted.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      expect(await admitted.text()).toContain('"result"');
    } else {
      expect(((await admitted.json()) as { result?: unknown }).result).toBeDefined();
    }
  });

  test('the SDK client fails to connect without the token and works with it', async () => {
    const { app } = makeApp({ env: { MCP_TOKEN: 'test-token' } });

    await expect(connectClient(app)).rejects.toThrow();

    const authorized = await connectClient(app, 'test-token');
    const { tools } = await authorized.listTools();
    expect(tools.length).toBe(4);
  });
});

describe('MCP DNS-rebinding guard', () => {
  test('rejects a cross-origin Host before the MCP handler runs', async () => {
    const { app } = makeApp();
    const response = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: { Host: 'evil.example:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { jsonrpc: string; error: { code: number }; id: null };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(-32_000);
    expect(body.id).toBeNull();
  });

  test('localhost Hosts pass the guard (the client tests depend on this)', async () => {
    const { app } = makeApp();
    const response = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: { Host: 'localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    // `ping` is not a served method on this endpoint, but the guard itself
    // must have passed the request through (405/4xx JSON-RPC, not 403).
    expect(response.status).not.toBe(403);
  });
});
