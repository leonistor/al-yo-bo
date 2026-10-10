/**
 * `get_search_state` — read the active search/filter/sort/page without DOM
 * scraping. Source of truth: the most recent TanStack Query entry for
 * `queryKeys.bookmarks.list`. `App.tsx` drives that query, so its queryKey
 * carries the entire effective filter set (debounced q, categoryId, tagId,
 * status, sort, direction, mode, offset/limit for pagination).
 */
import type { BookmarkListStatus, SearchMode, BookmarkSort } from '@al-yo-bo/shared';

import type { BookmarkSearchParams } from '@/lib/client';
import type { ToolDefinition } from '../types.ts';
import { getQueryClient } from '../client.ts';
import { latestListQuery } from '../cache.ts';

type Direction = 'asc' | 'desc';

interface SearchState {
  query: string;
  mode: SearchMode | null;
  categoryId: string | null;
  tagId: string | null;
  status: BookmarkListStatus;
  sort: BookmarkSort;
  direction: Direction;
  page: number;
  pageSize: number;
  resultCount: number;
  total: number;
  hasMore: boolean;
  hasActiveFilters: boolean;
  fetchedAt: number | null;
}

function readParams(raw: unknown): BookmarkSearchParams {
  if (raw && typeof raw === 'object') {
    return raw as BookmarkSearchParams;
  }
  return {};
}

function buildState(): SearchState | { error: string } {
  const client = getQueryClient();
  if (!client) {
    return { error: 'query_client_not_initialized' };
  }
  const query = latestListQuery(client);
  if (!query) {
    return {
      query: '',
      mode: null,
      categoryId: null,
      tagId: null,
      status: 'active',
      sort: 'created_at',
      direction: 'desc',
      page: 0,
      pageSize: 20,
      resultCount: 0,
      total: 0,
      hasMore: false,
      hasActiveFilters: false,
      fetchedAt: null,
    };
  }

  const params = readParams(query.queryKey[2]);
  const data = query.state.data;
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  return {
    query: params.q ?? '',
    mode: params.mode ?? null,
    categoryId: params.categoryId ?? null,
    tagId: params.tagId ?? null,
    status: params.status ?? 'active',
    sort: params.sort ?? 'created_at',
    direction: params.direction ?? 'desc',
    page: Math.floor(offset / Math.max(limit, 1)),
    pageSize: limit,
    resultCount: data?.items.length ?? 0,
    total: data?.total ?? 0,
    hasMore: data?.pagination.hasMore ?? false,
    hasActiveFilters:
      Boolean(params.q) ||
      Boolean(params.categoryId) ||
      Boolean(params.tagId) ||
      (params.status !== undefined && params.status !== 'active') ||
      Boolean(params.dateFrom) ||
      Boolean(params.dateTo),
    fetchedAt: query.state.dataUpdatedAt || null,
  };
}

export const getSearchState: ToolDefinition = {
  name: 'get_search_state',
  description: 'Return current search query, filters, sort, and result counts.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: () => buildState(),
};
