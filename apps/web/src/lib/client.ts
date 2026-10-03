import type {
  Aggregates,
  BookmarkListStatus,
  BookmarkSort,
  BookmarkWithTags,
  Category,
  ImportedBookmark,
  ImportReport,
  Profile,
  ReviewCandidate,
  SearchMode,
  SearchResponse,
  Section,
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

export function fetchCategories(): Promise<Category[]> {
  return api.api.categories.$get().then(async (response) => {
    if (!response.ok) {
      throw await toError(response);
    }
    return response.json();
  });
}

export function fetchSections(): Promise<Section[]> {
  return api.api.sections.$get().then(async (response) => {
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

export function createTag(input: { name: string; categoryId?: string | null }): Promise<Tag> {
  return api.api.tags
    .$post({ json: { name: input.name, categoryId: input.categoryId ?? null } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

export function createCategory(input: {
  name: string;
  sectionId?: string | null;
}): Promise<Category> {
  return api.api.categories
    .$post({ json: { name: input.name, sectionId: input.sectionId ?? null } })
    .then(async (response) => {
      if (!response.ok) {
        throw await toError(response);
      }
      return response.json();
    });
}

export function createSection(input: { name: string }): Promise<Section> {
  return api.api.sections
    .$post({ json: { name: input.name } })
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