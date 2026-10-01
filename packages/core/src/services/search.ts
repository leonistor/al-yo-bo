import type { Database } from 'bun:sqlite';

import {
  countKeywordMatches,
  getAggregates,
  getBookmarkStatuses,
  getBookmarksWithTagsByIds,
  keywordSearch,
  listBookmarks,
  listCategories,
} from '@al-yo-bo/db';
import type { EmbeddingClient } from '@al-yo-bo/embeddings';
import { fuseSearch } from '@al-yo-bo/search';
import {
  clampPagination,
  type Aggregates,
  type BookmarkListStatus,
  type BookmarkSort,
  type BookmarkStatus,
  type RankedCandidate,
  type SearchMode,
  type SearchResponse,
} from '@al-yo-bo/shared';

import type { CoreConfig } from '../config.ts';
import type { BookmarkHit } from '../dto.ts';
import type { VectorProvider } from '../vector/provider.ts';

export interface SearchInput {
  q: string;
  mode: SearchMode;
  datasetId?: string;
  categoryId?: string;
  tagId?: string;
  status: BookmarkListStatus;
  sort: BookmarkSort;
  direction: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SearchServiceDeps {
  db: Database;
  config: CoreConfig;
  vector: VectorProvider;
  embeddings?: EmbeddingClient;
  /** Dataset searches are scoped to. */
  datasetId: string;
}

export interface SearchService {
  search(input: SearchInput): Promise<SearchResponse>;
  chatHits(query: string, limit: number): Promise<BookmarkHit[]>;
  /** Library browse/stats read (counts per section/category/tag); owned here alongside search. */
  aggregates(): Aggregates;
}

/**
 * Drops semantic candidates that do not match the requested status in one batched
 * lookup, then re-ranks 1..n so the fused ordering stays coherent. Unknown ids
 * (already deleted) are dropped.
 */
function filterCandidatesByStatus(
  db: Database,
  candidates: RankedCandidate[],
  status: BookmarkStatus,
): RankedCandidate[] {
  const statuses = getBookmarkStatuses(
    db,
    candidates.map((candidate) => candidate.bookmarkId),
  );
  return candidates
    .filter((candidate) => statuses.get(candidate.bookmarkId) === status)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Search is the only service that owns the full hybrid pipeline (ARCHITECTURE
 * §6): keyword FTS5 + semantic KNN, fused with RRF when semantic candidates are
 * available, degrading to keyword-only everywhere else. The vector index is
 * resolved from the provider at the point of use so a hot-swapped index is used
 * by the next query.
 */
export function createSearchService(deps: SearchServiceDeps): SearchService {
  const { db, config, vector, embeddings, datasetId } = deps;

  /**
   * Semantic candidate list for the search query. Requires the whole chain to be
   * available (vector index with vectors, embedding client, configured model);
   * any missing link or failure returns an empty list, which degrades the search
   * to keyword-only — a normal state, never an error (ARCHITECTURE §6).
   */
  async function semanticCandidates(input: {
    q: string;
    mode: SearchMode;
    categoryId?: string;
    tagId?: string;
    limit: number;
    offset: number;
  }): Promise<RankedCandidate[]> {
    if (input.mode === 'keyword') {
      return [];
    }
    const index = vector.current();
    const model = config.embeddings.model;
    if (!embeddings || !model || index.size === 0) {
      return [];
    }
    try {
      const [queryVector] = (await embeddings.embed([input.q])).vectors;
      if (!queryVector) {
        return [];
      }
      // Category/tag filters are pushed into the vector query (server-side on
      // Qdrant, client-side overfetch on the in-memory fallback).
      return await index.search(queryVector, input.offset + input.limit, {
        categoryId: input.categoryId,
        tagId: input.tagId,
      });
    } catch (error) {
      console.warn('semantic search unavailable; returning keyword-only results', error);
      return [];
    }
  }

  async function search(input: SearchInput): Promise<SearchResponse> {
    const { limit, offset } = clampPagination(input.limit, input.offset);

    if (!input.q) {
      const { items, total } = listBookmarks(db, {
        datasetId: input.datasetId ?? datasetId,
        categoryId: input.categoryId,
        tagId: input.tagId,
        status: input.status,
        sort: input.sort,
        direction: input.direction,
        limit,
        offset,
      });
      return {
        items,
        total,
        mode: 'keyword',
        pagination: { limit, offset, hasMore: offset + items.length < total },
      };
    }

    const keywordTotal = countKeywordMatches(db, {
      q: input.q,
      datasetId: input.datasetId ?? datasetId,
      categoryId: input.categoryId,
      tagId: input.tagId,
      status: input.status,
    });

    // Fused modes fetch candidates from rank 0 over the whole page window, plus one
    // probe item past it so `hasMore` is observable; keyword-only pages in SQL.
    const window = offset + limit;
    const rawSemantic =
      input.mode === 'keyword'
        ? []
        : await semanticCandidates({
            q: input.q,
            mode: input.mode,
            categoryId: input.categoryId,
            tagId: input.tagId,
            limit: window + 1,
            offset: 0,
          });
    // Semantic hits bypass the SQL status filter, so apply it here before fusion.
    const semantic =
      input.status === 'all' || rawSemantic.length === 0
        ? rawSemantic
        : filterCandidatesByStatus(db, rawSemantic, input.status);
    const fusedMode = semantic.length > 0;

    const keyword = keywordSearch(db, {
      q: input.q,
      datasetId: input.datasetId ?? datasetId,
      categoryId: input.categoryId,
      tagId: input.tagId,
      status: input.status,
      // In fused modes both ranked lists must cover the same window, otherwise
      // page slices of the fused ranking would repeat or skip items across pages.
      limit: fusedMode ? window + 1 : limit,
      offset: fusedMode ? 0 : offset,
    });

    const fused = fuseSearch(keyword, semantic, input.mode);
    const mode: SearchMode = fusedMode ? input.mode : 'keyword';

    if (!fusedMode) {
      const items = getBookmarksWithTagsByIds(
        db,
        keyword.map((candidate) => candidate.bookmarkId),
      );
      return {
        items,
        total: keywordTotal,
        mode,
        pagination: { limit, offset, hasMore: offset + items.length < keywordTotal },
      };
    }

    // Semantic contributed: pages are slices of the fused ranking over the fetched
    // window. Semantic top-k has no total, so `total` is a monotonic lower bound
    // ("at least this many results"): past pages stay counted, the probe item makes
    // `hasMore` exact, and a finished window reports exactly what was seen.
    const page = fused.slice(offset, window);
    const hasMore = fused.length > window;
    const items = getBookmarksWithTagsByIds(
      db,
      page.map((candidate) => candidate.bookmarkId),
    );

    return {
      items,
      total: hasMore
        ? Math.max(keywordTotal, window + 1)
        : Math.max(keywordTotal, offset + items.length),
      mode,
      pagination: { limit, offset, hasMore },
    };
  }

  /**
   * Runs the same search path as `GET /api/bookmarks` (hybrid when available) and
   * returns compact, LLM-friendly hits — never page content. Used by the chat
   * `searchBookmarks` tool (ARCHITECTURE §2).
   */
  async function chatHits(query: string, limit: number): Promise<BookmarkHit[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const response = await search({
      q: trimmed,
      mode: 'hybrid',
      // Chat never surfaces invalid bookmarks.
      status: 'active',
      sort: 'created_at',
      direction: 'desc',
      limit,
      offset: 0,
    });
    const categoryNameById = new Map(
      listCategories(db, datasetId).map((category) => [category.id, category.name]),
    );
    return response.items.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      description: item.description,
      tags: item.tags.map((tag) => tag.name),
      categoryName: item.categoryId ? (categoryNameById.get(item.categoryId) ?? null) : null,
      updatedAt: item.updatedAt,
    }));
  }

  function aggregates(): Aggregates {
    return getAggregates(db, datasetId);
  }

  return { search, chatHits, aggregates };
}
