/**
 * `list_visible_bookmarks` and `get_bookmark`.
 *
 * `list_visible_bookmarks` reports the IDs/items currently rendered in the
 * active page slice (most-recently-updated list query in the TanStack cache).
 * Supports optional `limit`/`offset` for paging through that one slice.
 *
 * `get_bookmark` resolves a single id by scanning every cached list query —
 * the bookmark may live on a different page than the one the user is looking
 * at. If no cached list has it, returns `{ ok: false, error: 'not_found' }`
 * and the agent should re-navigate via a search tool before retrying.
 */
import type { BookmarkWithTags, SearchResponse } from '@al-yo-bo/shared';

import type { ToolDefinition } from '../types.ts';
import { getQueryClient } from '../client.ts';
import { allListQueries, latestListQuery } from '../cache.ts';

interface ListVisibleArgs {
  limit?: number;
  offset?: number;
}

export const listVisibleBookmarks: ToolDefinition = {
  name: 'list_visible_bookmarks',
  description: 'List IDs of bookmarks currently rendered in the active view.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', minimum: 1, maximum: 200 },
      offset: { type: 'number', minimum: 0 },
    },
    additionalProperties: false,
  },
  execute: (args) => {
    const typedArgs = args as unknown as ListVisibleArgs;
    const client = getQueryClient();
    if (!client) {
      return { error: 'query_client_not_initialized', items: [], total: 0 };
    }
    const query = latestListQuery(client);
    if (!query || !query.state.data) {
      return { items: [], total: 0, page: 0, hasMore: false };
    }
    const data = query.state.data;
    const limit = clampInt(typedArgs.limit, 1, 200, data.items.length);
    const offset = clampInt(typedArgs.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const slice = data.items.slice(offset, offset + limit);
    const params = (query.queryKey[2] ?? {}) as { limit?: number; offset?: number };
    return {
      page: Math.floor((params.offset ?? 0) / Math.max(params.limit ?? 20, 1)),
      total: data.total,
      offset,
      count: slice.length,
      hasMore: data.pagination.hasMore,
      items: slice.map((b) => ({
        id: b.id,
        title: b.title,
        url: b.url,
        status: b.status,
        tags: b.tags.map((t) => t.name),
      })),
    };
  },
};

interface GetBookmarkArgs {
  id: string;
}

interface NotFoundResult {
  ok: false;
  error: 'not_found' | 'invalid_id' | 'query_client_not_initialized';
}

function findInCache(client: NonNullable<ReturnType<typeof getQueryClient>>, id: string): BookmarkWithTags | null {
  for (const q of allListQueries(client)) {
    const items = (q.state.data as SearchResponse | undefined)?.items;
    const hit = items?.find((b) => b.id === id);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export const getBookmark: ToolDefinition = {
  name: 'get_bookmark',
  description: 'Return one bookmark record by id; returns not_found if missing.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    required: ['id'],
    additionalProperties: false,
  },
  execute: (args) => {
    const typedArgs = args as unknown as GetBookmarkArgs;
    const client = getQueryClient();
    if (!client) {
      const result: NotFoundResult = { ok: false, error: 'query_client_not_initialized' };
      return result;
    }
    if (typeof typedArgs.id !== 'string' || typedArgs.id.length === 0) {
      const result: NotFoundResult = { ok: false, error: 'invalid_id' };
      return result;
    }
    const bookmark = findInCache(client, typedArgs.id);
    if (!bookmark) {
      const result: NotFoundResult = { ok: false, error: 'not_found' };
      return result;
    }
    return {
      ok: true as const,
      bookmark: {
        id: bookmark.id,
        url: bookmark.url,
        title: bookmark.title,
        description: bookmark.description,
        content: bookmark.content,
        status: bookmark.status,
        categoryId: bookmark.categoryId,
        scrapedAt: bookmark.scrapedAt,
        createdAt: bookmark.createdAt,
        updatedAt: bookmark.updatedAt,
        scrapeAttempts: bookmark.scrapeAttempts,
        tags: bookmark.tags.map((t) => ({
          id: t.tagId,
          name: t.name,
          source: t.source,
          confidence: t.confidence,
        })),
        image: bookmark.image ?? null,
        snippet: bookmark.snippet ?? null,
      },
    };
  },
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
