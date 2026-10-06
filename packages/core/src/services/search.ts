import type { Database } from 'bun:sqlite';

import type { EmbeddingClient } from '@al-yo-bo/ai';
import {
  countKeywordMatches,
  getAggregates,
  getBookmarkCategoryIds,
  getBookmarkStatuses,
  getBookmarksWithTagsByIds,
  keywordSearch,
  listBookmarks,
  listCategories,
  listCategorySubtreeIds,
} from '@al-yo-bo/db';
import { fuseSearch } from '@al-yo-bo/search';
import {
  clampPagination,
  type Aggregates,
  type BookmarkListStatus,
  type BookmarkSort,
  type BookmarkStatus,
  type BookmarkWithTags,
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
  categoryId?: string;
  tagId?: string;
  /** Epoch-ms bounds on `created_at` (inclusive); set ⇒ keyword-only, since KNN has no date predicate. */
  dateFrom?: number;
  dateTo?: number;
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
}

export interface SearchService {
  search(input: SearchInput): Promise<SearchResponse>;
  chatHits(query: string, limit: number): Promise<BookmarkHit[]>;
  /** Library browse/stats read (counts per category/tag); owned here alongside search. */
  aggregates(): Aggregates;
}

/**
 * Widens the vector-query window when the category filter is applied
 * client-side, so candidates that survive the subtree filter can still fill
 * the requested window. Mirrors the fallback decorators' overfetch factor
 * (packages/search/src/fallback.ts).
 */
const SUBTREE_FILTER_OVERFETCH = 8;

/**
 * Drops semantic candidates shelved outside the requested category subtree.
 * The vector backends only support single-category payload equality, so
 * pushing the categoryId down would silently drop bookmarks in child
 * categories — instead the subtree id set (same recursive CTE as the keyword
 * filter) is matched client-side. Survival is decided by each candidate's own
 * category, batched in one lookup; unknown ids (already deleted) are dropped,
 * and survivors are re-ranked 1..n so RRF fusion stays coherent.
 */
function filterCandidatesBySubtree(
  db: Database,
  candidates: RankedCandidate[],
  categoryId: string,
  window: number,
): RankedCandidate[] {
  const subtreeIds = new Set(listCategorySubtreeIds(db, categoryId));
  const categoryIds = getBookmarkCategoryIds(
    db,
    candidates.map((candidate) => candidate.bookmarkId),
  );
  // Object.assign instead of a spread (oxc/no-map-spread): fresh copies, so the
  // fused candidates the caller still holds are never mutated.
  return candidates
    .filter((candidate) => {
      const ownCategory = categoryIds.get(candidate.bookmarkId);
      return ownCategory !== undefined && ownCategory !== null && subtreeIds.has(ownCategory);
    })
    .slice(0, Math.max(0, window))
    .map((candidate, index) => Object.assign({}, candidate, { rank: index + 1 }));
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
  // Object.assign instead of a spread (oxc/no-map-spread): fresh copies, so the
  // fused candidates the caller still holds are never mutated.
  return candidates
    .filter((candidate) => statuses.get(candidate.bookmarkId) === status)
    .map((candidate, index) => Object.assign({}, candidate, { rank: index + 1 }));
}

/**
 * Attaches the FTS snippet (when one exists) to the corresponding bookmark.
 * Keyword-only hits always carry a snippet; fused hits keep the snippet from
 * the keyword side; semantic-only hits have none. Fresh objects are returned
 * so callers that do not care about snippets can still ignore the field.
 */
function attachSnippets(
  items: BookmarkWithTags[],
  candidates: RankedCandidate[],
): BookmarkWithTags[] {
  const snippets = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.snippet && !snippets.has(candidate.bookmarkId)) {
      snippets.set(candidate.bookmarkId, candidate.snippet);
    }
  }
  return items.map((item) => {
    const snippet = snippets.get(item.id);
    return snippet ? Object.assign({}, item, { snippet }) : item;
  });
}

/**
 * Search is the only service that owns the full hybrid pipeline (ARCHITECTURE
 * §6): keyword FTS5 + semantic top-k, fused with RRF when semantic candidates
 * are available, degrading to keyword-only everywhere else. The vector index is
 * resolved from the provider at the point of use so a hot-swapped index is used
 * by the next query. There is no dataset axis: both paths are unfiltered by
 * anything but the user's query and the category/tag filters (MODEL.md
 * principle 1).
 */
export function createSearchService(deps: SearchServiceDeps): SearchService {
  const { db, config, vector, embeddings } = deps;

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
      // The category filter matches the whole subtree (keyword parity), which
      // neither vector backend can express — both do single-category payload
      // equality. So the categoryId is deliberately NOT pushed down; the
      // subtree filter is applied client-side after an overfetch (same
      // overfetch-and-filter pattern the fallback decorators use), and only
      // the tag filter is pushed into the vector query. The filter object is
      // built only when a field is actually set: an all-undefined filter is
      // still truthy, and the decorators would needlessly overfetch 8x and
      // batch-resolve payloads on every query.
      const window = input.offset + input.limit;
      const filter = input.tagId !== undefined ? { tagId: input.tagId } : undefined;
      const candidates = await index.search(
        queryVector,
        input.categoryId !== undefined ? window * SUBTREE_FILTER_OVERFETCH : window,
        filter,
      );
      return input.categoryId !== undefined
        ? filterCandidatesBySubtree(db, candidates, input.categoryId, window)
        : candidates;
    } catch (error) {
      console.warn('semantic search unavailable; returning keyword-only results', error);
      return [];
    }
  }

  async function search(input: SearchInput): Promise<SearchResponse> {
    const { limit, offset } = clampPagination(input.limit, input.offset);

    if (!input.q) {
      const { items, total } = listBookmarks(db, {
        categoryId: input.categoryId,
        tagId: input.tagId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
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
      categoryId: input.categoryId,
      tagId: input.tagId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      status: input.status,
    });

    // Fused modes fetch candidates from rank 0 over the whole page window, plus one
    // probe item past it so `hasMore` is observable; keyword-only pages in SQL.
    const window = offset + limit;
    // Date-bounded searches stay keyword-only: the semantic index has no date
    // predicate, so hybrid hits could not honor the range (ARCHITECTURE §7 export
    // mirrors this rule for its date filters).
    const rawSemantic =
      input.mode === 'keyword' || input.dateFrom !== undefined || input.dateTo !== undefined
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
      categoryId: input.categoryId,
      tagId: input.tagId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      status: input.status,
      // In fused modes both ranked lists must cover the same window, otherwise
      // page slices of the fused ranking would repeat or skip items across pages.
      limit: fusedMode ? window + 1 : limit,
      offset: fusedMode ? 0 : offset,
    });

    const fused = fuseSearch(keyword, semantic, input.mode);
    const mode: SearchMode = fusedMode ? input.mode : 'keyword';

    if (!fusedMode) {
      const items = attachSnippets(
        getBookmarksWithTagsByIds(
          db,
          keyword.map((candidate) => candidate.bookmarkId),
        ),
        keyword,
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
    const items = attachSnippets(
      getBookmarksWithTagsByIds(
        db,
        page.map((candidate) => candidate.bookmarkId),
      ),
      page,
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
      listCategories(db).map((category) => [category.id, category.name]),
    );
    return response.items.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      description: item.description,
      tags: item.tags.map((tag) => tag.name),
      categoryName: item.categoryId ? (categoryNameById.get(item.categoryId) ?? null) : null,
      image: item.image ?? null,
      updatedAt: item.updatedAt,
    }));
  }

  function aggregates(): Aggregates {
    return getAggregates(db);
  }

  return { search, chatHits, aggregates };
}
