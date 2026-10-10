/**
 * Helpers to find the most recent bookmarks list query in the TanStack cache.
 *
 * Every TanStack-managed list query (page, filter, sort permutations) is in
 * the cache after a single session; the most recently updated one with data
 * is the one the user is currently looking at. We key off that to expose
 * search/filter state without touching `App.tsx`.
 */
import type { QueryClient, Query } from '@tanstack/react-query';
import type { SearchResponse } from '@al-yo-bo/shared';

import { queryKeys } from '@/lib/queryKeys';

const LIST_KEY_PREFIX = [...queryKeys.bookmarks.list({})].slice(0, 2) as [
  string,
  string,
];

type ListQuery = Query<SearchResponse, Error, SearchResponse, readonly unknown[]>;

export function latestListQuery(client: QueryClient): ListQuery | null {
  const all = client.getQueryCache().findAll({ queryKey: LIST_KEY_PREFIX });
  // The cache is heterogeneous, so `findAll` widens TData to `unknown`. We
  // assert the narrower type here because every list entry under this prefix
  // is shaped like `SearchResponse` — App.tsx is the only caller of
  // `fetchBookmarks` in the running app.
  const withData = all.filter((q) => q.state.data !== undefined) as ListQuery[];
  if (withData.length === 0) {
    return null;
  }
  withData.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  return withData[0] ?? null;
}

export function allListQueries(client: QueryClient): ListQuery[] {
  return client
    .getQueryCache()
    .findAll({ queryKey: LIST_KEY_PREFIX })
    .filter((q) => q.state.data !== undefined) as ListQuery[];
}

