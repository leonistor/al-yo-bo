import type {
  Aggregates,
  BookmarkListStatus,
  BookmarkSort,
  BookmarkWithTags,
  Category,
  CategoryNode,
  ImportedBookmark,
  ImportReport,
  Profile,
  ReviewCandidate,
  SearchMode,
  SearchResponse,
  Tag,
  TagStatus,
} from '@al-yo-bo/shared';

import { api } from './api.ts';

/**
 * Hono's `ClientResponse.ok` is a literal discriminant (true for 2xx), so
 * `if (!response.ok)` at the call site removes the route's error variants from
 * the response union — the surviving `response.json()` is typed by the server
 * schema via `hc<AppType>` inference, with no caller-side casts. These helpers
 * split that pattern: `unwrap` for JSON bodies, `unwrapEmpty` for 204 routes.
 */
async function toError(response: { status: number; json: () => Promise<unknown> }): Promise<Error> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { title?: unknown };
    if (typeof body?.title === 'string') {
      message = body.title;
    }
  } catch {
    // Non-JSON error bodies are ignored; the status-based message is enough.
  }
  return new Error(message);
}

export interface LanInterface {
  name: string;
  address: string;
}

export function fetchLanInterfaces(): Promise<LanInterface[]> {
  return api.api.lan.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export interface BookmarkSearchParams {
  q?: string;
  mode?: SearchMode;
  categoryId?: string;
  tagId?: string;
  status?: BookmarkListStatus;
  /** ISO date (`YYYY-MM-DD`); expanded to inclusive UTC day bounds server-side. */
  dateFrom?: string;
  dateTo?: string;
  sort?: BookmarkSort;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export function fetchBookmarks(params: BookmarkSearchParams = {}): Promise<SearchResponse> {
  const query = {
    ...(params.q ? { q: params.q } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.tagId ? { tagId: params.tagId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
    ...(params.dateTo ? { dateTo: params.dateTo } : {}),
    ...(params.sort ? { sort: params.sort } : {}),
    ...(params.direction ? { direction: params.direction } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    ...(params.offset !== undefined ? { offset: params.offset } : {}),
  };
  return api.api.bookmarks.$get({ query }).then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export function fetchAggregates(): Promise<Aggregates> {
  return api.api.aggregates.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

/** The singleton profile row; null only when the schema was tampered with. */
export function fetchProfile(): Promise<Profile | null> {
  return api.api.profile.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

/** Partial update of the singleton profile. Only name/githubUsername are exposed to the web app. */
export function updateProfile(patch: {
  name?: string | null;
  githubUsername?: string | null;
}): Promise<Profile> {
  return api.api.profile
    .$patch({ json: patch })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/** Upload a JPEG/PNG avatar (max 2 MB). The server returns the updated profile. */
export function uploadAvatar(file: File): Promise<Profile> {
  const formData = new FormData();
  formData.append('avatar', file);
  return api.api.profile.avatar
    .$post({}, { init: { body: formData } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/** Remove the uploaded avatar. Returns the updated profile; 404 when no avatar exists. */
export function deleteAvatar(): Promise<Profile> {
  return api.api.profile.avatar.$delete().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

/** Health report inferred from the Hono RPC response type (no direct @al-yo-bo/core import). */
type HealthRpc = Awaited<ReturnType<typeof api.api.health.$get>>;
export type HealthReport = Awaited<ReturnType<HealthRpc['json']>>;

/** Aggregated subsystem health; failures are surfaced per-row in the UI. */
export function fetchHealth(): Promise<HealthReport> {
  return api.api.health.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

/**
 * The nested category tree (MODEL.md principle 2) — roots and children in
 * fractional `sortOrder` order. All category writes flow through the tree
 * mutations in `useCategoryMutations` so optimistic updates share one shape.
 */
export function fetchCategories(): Promise<CategoryNode[]> {
  return api.api.categories.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export function fetchTags(): Promise<Tag[]> {
  return api.api.tags.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export function fetchReviewCandidates(): Promise<ReviewCandidate[]> {
  return api.api.review.candidates.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export interface ImportPreview {
  parsed: number;
  skipped: number;
  bookmarks: ImportedBookmark[];
  provider: 'llm' | 'fallback';
  warnings?: string[];
}

export function extractImport(text: string): Promise<ImportPreview> {
  return api.api.import.preview.$post({ json: { markdown: text } }).then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

/**
 * Commits the user-confirmed, possibly edited bookmark list. The server
 * re-resolves vocabulary (auto-create) and dedups by URL; the client only
 * ships what the Import page shows as included.
 */
export function commitImport(bookmarks: ImportedBookmark[]): Promise<ImportReport> {
  return api.api.import.$post({ json: { bookmarks } }).then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export interface CreateBookmarkInput {
  url: string;
  title?: string | null;
  description?: string | null;
  categoryId?: string | null;
}

export function createBookmark(input: CreateBookmarkInput): Promise<BookmarkWithTags> {
  return api.api.bookmarks
    .$post({
      json: {
        url: input.url,
        title: input.title ?? null,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
      },
    })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

export function updateBookmark(
  id: string,
  patch: { title?: string | null; description?: string | null; categoryId?: string | null },
): Promise<BookmarkWithTags> {
  const json = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
  };
  return api.api.bookmarks[':id']
    .$patch({ param: { id }, json })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/** 204 routes have no body; the ok guard is all that's needed. */
export function deleteBookmark(id: string): Promise<void> {
  return api.api.bookmarks[':id']
    .$delete({ param: { id } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
    });
}

export interface ScrapeResponse {
  status: 'scraped' | 'unchanged' | 'missing';
  bookmark: BookmarkWithTags;
}

/** Manual re-scrape; runs inline (bounded by the server's scrape timeout). */
export function scrapeBookmark(id: string): Promise<ScrapeResponse> {
  return api.api.bookmarks[':id'].scrape.$post({ param: { id } }).then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export function assignTagToBookmark(bookmarkId: string, tagId: string): Promise<BookmarkWithTags> {
  return api.api.bookmarks[':id'].tags
    .$post({ param: { id: bookmarkId }, json: { tagId } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

export function removeTagFromBookmark(bookmarkId: string, tagId: string): Promise<void> {
  return api.api.bookmarks[':id'].tags[':tagId']
    .$delete({ param: { id: bookmarkId, tagId } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
    });
}

export function setTagStatus(id: string, status: TagStatus): Promise<Tag> {
  return api.api.tags[':id'].status
    .$post({ param: { id }, json: { status } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

export function createTag(input: { name: string; description?: string | null }): Promise<Tag> {
  return api.api.tags
    .$post({ json: { name: input.name, description: input.description ?? null } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/** Renames/describes a tag; only supplied fields are sent. */
export function updateTag(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<Tag> {
  const json = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
  };
  return api.api.tags[':id']
    .$patch({ param: { id }, json })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/** 204 routes have no body; the ok guard is all that's needed. */
export function deleteTag(id: string): Promise<void> {
  return api.api.tags[':id']
    .$delete({ param: { id } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
    });
}

export function createCategory(input: {
  name: string;
  parentId?: string | null;
  description?: string | null;
}): Promise<Category> {
  return api.api.categories
    .$post({
      json: {
        name: input.name,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
      },
    })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/** Renames/describes a category; only supplied fields are sent. */
export function updateCategory(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<Category> {
  const json = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
  };
  return api.api.categories[':id']
    .$patch({ param: { id }, json })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/**
 * Re-parents a category (subtree included) to `parentId` — `null` moves to
 * root — optionally at an explicit fractional `sortOrder`. Distinct from
 * `updateCategory` because the PATCH route branches on `parentId`.
 */
export function moveCategory(
  id: string,
  parentId: string | null,
  sortOrder?: string,
): Promise<Category> {
  return api.api.categories[':id']
    .$patch({
      param: { id },
      json: { parentId, ...(sortOrder !== undefined ? { sortOrder } : {}) },
    })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/**
 * Persists one sibling-list reorder: `parentId` null = roots, `orderedIds` is
 * the complete sibling list in the desired order (server rebalances the
 * fractional keys from it — MODEL.md principle 2).
 */
export function reorderCategories(parentId: string | null, orderedIds: string[]): Promise<Category[]> {
  return api.api.categories.reorder
    .$post({ json: { parentId, orderedIds } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

/**
 * Deletes a category and its subtree (children cascade, bookmarks survive
 * with `category_id` NULL — MODEL.md deletion semantics). Returns the subtree
 * counts the UI confirmed against.
 */
export function deleteCategory(id: string): Promise<{ categories: number; bookmarks: number }> {
  return api.api.categories[':id']
    .$delete({ param: { id } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

export function acceptCandidate(bookmarkId: string, tagId: string): Promise<BookmarkWithTags> {
  return api.api.review.candidates.accept
    .$post({ json: { bookmarkId, tagId } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}
