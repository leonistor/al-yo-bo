/**
 * Bookmarks MCP server (ARCHITECTURE §8) — the read-only agent surface over the
 * core services, mounted in the Hono app at `/mcp` as streamable HTTP.
 *
 * Composition (all official MCP TS SDK v2):
 * - `createMcpHonoApp()` (`@modelcontextprotocol/hono`) arms the localhost
 *   Host/Origin DNS-rebinding guard by default and pre-parses JSON bodies into
 *   `parsedBody` — mounting the sub-app under `/mcp` scopes both to the mount
 *   prefix (Hono prefixes `use('*')` middleware on `route()`), so the rest of
 *   the API is unaffected.
 * - `createMcpHandler()` (`@modelcontextprotocol/server`) serves each request
 *   with a fresh `McpServer` from the factory below (per-request stateless
 *   instances — the SDK's stateless idiom) and falls back to 2025-era stateless
 *   serving for legacy clients.
 * - `MCP_TOKEN` (optional): when set, a bearer check gates every MCP request;
 *   unset → loopback-only, no token (§8 "Loopback + token").
 *
 * **stdio reuse (§8 "Optional stdio build"):** the tool/resource surface lives
 * entirely in `registerBookmarksSurface(server, core)` — transport-neutral,
 * one core service call per tool. A future stdio entry for Claude Desktop is a
 * thin file that builds `core`, then:
 *
 * ```ts
 * const server = new McpServer({ name: 'al-yo-bo-bookmarks', version: VERSION });
 * registerBookmarksSurface(server, core);
 * await server.connect(new StdioServerTransport());
 * ```
 *
 * No write tools by design (§8): MCP clients can read and search, never mutate.
 */

import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import {
  createMcpHandler,
  McpServer,
  ResourceTemplate,
  type McpServerFactory,
} from '@modelcontextprotocol/server';
import type { Core } from '@al-yo-bo/core';
import { NotFoundError } from '@al-yo-bo/core';
import { isUuid, type CategoryNode } from '@al-yo-bo/shared';
import type { Hono, MiddlewareHandler } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { ServerConfig } from './env.ts';

// The adapter pre-parses JSON bodies into `c.set('parsedBody', ...)` but (as of
// 2.0.2) ships no Hono module augmentation, so the variable is untyped on our
// side. Declaring it here types the read in the endpoint below — the single
// consumer — and matches what the adapter writes at runtime.
declare module 'hono' {
  interface ContextVariableMap {
    parsedBody: unknown;
  }
}

/** Server identity advertised in the MCP `initialize` handshake. */
const MCP_SERVER_NAME = 'al-yo-bo-bookmarks';
const MCP_SERVER_VERSION = '0.1.0';

/** Tool result caps (§8): compact hits, a hard limit on the search page size. */
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 10;
const DESCRIPTION_EXCERPT_CHARS = 200;

/** `resources/list` probe size for the `bookmark://{id}` template's list callback. */
const RESOURCE_LIST_LIMIT = 100;

function excerpt(text: string | null): string | null {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  return trimmed.length <= DESCRIPTION_EXCERPT_CHARS
    ? trimmed
    : `${trimmed.slice(0, DESCRIPTION_EXCERPT_CHARS)}…`;
}

/**
 * Category id → slash-joined ancestor path (e.g. `Dev tools / CLI`) for the
 * search hits. One tree walk per search call — trivial at personal scale.
 */
function categoryPaths(core: Core): Map<string, string> {
  const paths = new Map<string, string>();
  const walk = (nodes: CategoryNode[], prefix: string): void => {
    for (const node of nodes) {
      const path = prefix ? `${prefix} / ${node.name}` : node.name;
      paths.set(node.id, path);
      walk(node.children, path);
    }
  };
  walk(core.vocabulary.getCategoryTree(), '');
  return paths;
}

/** One compact, LLM-facing hit — never page content (§8 / §2 chat contract). */
interface McpSearchHit {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
}

/**
 * The entire MCP surface — four read-only tools plus the `bookmark://{id}`
 * resource template — registered on one `McpServer`. Kept as a standalone
 * function so the streamable-HTTP mount and a future stdio entry share the
 * exact same implementations (see the module doc comment).
 */
export function registerBookmarksSurface(server: McpServer, core: Core): void {
  server.registerTool(
    'search_bookmarks',
    {
      title: 'Search bookmarks',
      description:
        'Search the user’s bookmark library. Hybrid keyword + semantic ranking (degrades to keyword-only when the semantic stack is offline). ' +
        'Returns compact hits — id, url, title, description excerpt, category path, tag names — never page content. ' +
        'Use get_bookmark for the full record of a hit.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        q: z.string().min(1).describe('Search text, matched against titles, descriptions and scraped page content.'),
        categoryId: z.uuid().describe('Restrict hits to this category and its whole subtree.').optional(),
        tagId: z.uuid().describe('Restrict hits to bookmarks carrying this tag.').optional(),
        status: z
          .enum(['active', 'invalid', 'all'])
          .describe('Bookmark lifecycle filter: `active` (default) hides dead links; `all` includes them.')
          .default('active'),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).describe(`Maximum hits to return (1–${MAX_SEARCH_LIMIT}).`).default(DEFAULT_SEARCH_LIMIT),
      }),
    },
    async ({ q, categoryId, tagId, status, limit }) => {
      const response = await core.search.search({
        q,
        // Hybrid is the default path (§8); core degrades to keyword-only
        // automatically when embeddings or the vector index are unavailable.
        mode: 'hybrid',
        categoryId,
        tagId,
        status,
        sort: 'created_at',
        direction: 'desc',
        limit,
        offset: 0,
      });
      const paths = categoryPaths(core);
      const hits: McpSearchHit[] = response.items.map((bookmark) => ({
        id: bookmark.id,
        url: bookmark.url,
        title: bookmark.title,
        description: excerpt(bookmark.description),
        category: bookmark.categoryId ? (paths.get(bookmark.categoryId) ?? null) : null,
        tags: bookmark.tags.map((tag) => tag.name),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(hits) }] };
    },
  );

  server.registerTool(
    'get_bookmark',
    {
      title: 'Get bookmark',
      description:
        'Fetch one bookmark by id (the id of a search_bookmarks hit): url, title, description, status, timestamps, tags and the scraped page content when present.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        id: z.uuid().describe('Bookmark id (UUID) — take it from a search_bookmarks hit or a bookmark:// resource URI.'),
      }),
    },
    async ({ id }) => {
      const bookmark = core.bookmarks.get(id);
      return { content: [{ type: 'text', text: JSON.stringify(bookmark) }] };
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description:
        'The full category tree (nested, in display order) with the bookmark count per category. Use a node’s id with search_bookmarks’ categoryId to browse a subtree.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
    },
    async () => {
      const tree = core.vocabulary.getCategoryTree();
      const counts = new Map(core.search.aggregates().categories.map((entry) => [entry.id, entry.count]));
      // Attach counts without mutating core's freshly built tree nodes.
      const withCounts = (nodes: CategoryNode[]): unknown[] =>
        nodes.map((node) => ({
          id: node.id,
          name: node.name,
          description: node.description,
          count: counts.get(node.id) ?? 0,
          children: withCounts(node.children),
        }));
      return { content: [{ type: 'text', text: JSON.stringify(withCounts(tree)) }] };
    },
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description:
        'All tags with their lifecycle status (`active` / `deprecated`) and description. Use a tag id with search_bookmarks’ tagId; deprecated tags are kept for history only.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({}),
    },
    async () => {
      const tags = core.vocabulary.listTags().map((tag) => ({
        id: tag.id,
        name: tag.name,
        status: tag.status,
        description: tag.description,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(tags) }] };
    },
  );

  server.registerResource(
    'bookmark',
    new ResourceTemplate('bookmark://{id}', {
      // Listable cheaply at personal scale: one uncapped-enough listing (the
      // 100-row page clamp covers it) turns the template into browsable
      // resources instead of ids the client must guess (§8).
      list: async () => {
        const response = await core.search.search({
          q: '',
          mode: 'keyword',
          status: 'active',
          sort: 'created_at',
          direction: 'desc',
          limit: RESOURCE_LIST_LIMIT,
          offset: 0,
        });
        return {
          resources: response.items.map((bookmark) => ({
            uri: `bookmark://${bookmark.id}`,
            name: bookmark.title ?? bookmark.url,
            title: bookmark.title ?? undefined,
            description: excerpt(bookmark.description) ?? undefined,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Bookmark',
      description:
        'A full bookmark record (url, title, description, status, timestamps, tags, scraped content when present) as JSON. Read with the id from search_bookmarks hits or resources/list.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = String(variables['id']);
      // Malformed ids are "missing", mirroring the HTTP API's pathId convention
      // (a garbage id must not surface as a codec 500).
      if (!isUuid(id)) {
        throw new NotFoundError('Bookmark not found');
      }
      const bookmark = core.bookmarks.get(id);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(bookmark) }],
      };
    },
  );
}

/** Per-request `McpServer` factory for `createMcpHandler` (stateless serving). */
function mcpServerFactory(core: Core): McpServerFactory {
  return () => {
    const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, {
      instructions:
        'Read-only access to the user’s bookmark library: search_bookmarks to find bookmarks (compact hits), get_bookmark or bookmark://{id} for the full record, list_categories and list_tags for the vocabulary.',
    });
    registerBookmarksSurface(server, core);
    return server;
  };
}

/** Fixed-length digest for timing-safe comparison of short secrets. */
function secretDigest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Timing-safe bearer comparison: both sides are hashed to a fixed length
 * first, so neither the token length nor a byte-position timing channel leaks.
 */
function bearerTokenMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) {
    return false;
  }
  return timingSafeEqual(secretDigest(presented), secretDigest(expected));
}

/**
 * Optional bearer gate (§8 "Loopback + token"): active only when `MCP_TOKEN`
 * is configured. The JSON-RPC error body matches the shape the SDK's own
 * Host/Origin guards answer with; `WWW-Authenticate: Bearer` follows RFC 6750
 * so MCP clients can react to the challenge.
 */
function requireBearerToken(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (bearerTokenMatches(c.req.header('authorization'), `Bearer ${token}`)) {
      return await next();
    }
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32_000, message: 'Unauthorized: a valid bearer token is required' },
        id: null,
      },
      401,
      { 'WWW-Authenticate': 'Bearer' },
    );
  };
}

/**
 * Builds the `/mcp` sub-app: DNS-rebinding guard + body parsing (from the
 * adapter), optional bearer gate, then the streamable-HTTP endpoint. Mounted
 * into the main Hono app by `createApp` (the prefix scopes the sub-app's
 * `use('*')` middleware to `/mcp`, verified against Hono's `route()` prefixing).
 */
export function createMcpRoutes(core: Core, config: ServerConfig): Hono {
  // host defaults to '127.0.0.1', which arms the localhost Host/Origin guards.
  const mcp = createMcpHonoApp();
  const token = config.mcp.token;
  if (token !== undefined) {
    mcp.use('*', requireBearerToken(token));
  }
  const handler = createMcpHandler(mcpServerFactory(core));
  mcp.all('/', async (c) => handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody') }));
  return mcp;
}

/** The `/api/health` mcp block (§8 mount status; kept minimal). */
export function mcpHealth(config: ServerConfig): { mounted: true; auth: 'bearer' | 'loopback' } {
  return { mounted: true, auth: config.mcp.token !== undefined ? 'bearer' : 'loopback' };
}
