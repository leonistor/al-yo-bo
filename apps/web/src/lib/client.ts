import type {
  Aggregates,
  BookmarkSort,
  BookmarkWithTags,
  Category,
  ReviewCandidate,
  SearchMode,
  SearchResponse,
  Tag,
  TagStatus,
} from '@al-yo-bo/shared';

import { api } from './api.ts';

interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

async function unwrap<T>(response: JsonResponse): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { title?: string };
      if (body.title) {
        message = body.title;
      }
    } catch {
      // Non-JSON error bodies are ignored; the status-based message is enough.
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export interface BookmarkSearchParams {
  q?: string;
  mode?: SearchMode;
  categoryId?: string;
  tagId?: string;
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
    ...(params.sort ? { sort: params.sort } : {}),
    ...(params.direction ? { direction: params.direction } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    ...(params.offset !== undefined ? { offset: params.offset } : {}),
  };
  return api.api.bookmarks.$get({ query }).then((response) => unwrap<SearchResponse>(response));
}

export function fetchAggregates(): Promise<Aggregates> {
  return api.api.aggregates.$get().then((response) => unwrap<Aggregates>(response));
}

export function fetchCategories(): Promise<Category[]> {
  return api.api.categories.$get().then((response) => unwrap<Category[]>(response));
}

export function fetchTags(): Promise<Tag[]> {
  return api.api.tags.$get().then((response) => unwrap<Tag[]>(response));
}

export function fetchProposedTags(): Promise<Tag[]> {
  return api.api.review['proposed-tags']
    .$get()
    .then((response) => unwrap<Tag[]>(response));
}

export function fetchReviewCandidates(): Promise<ReviewCandidate[]> {
  return api.api.review.candidates.$get().then((response) => unwrap<ReviewCandidate[]>(response));
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
    .then((response) => unwrap<BookmarkWithTags>(response));
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
    .then((response) => unwrap<BookmarkWithTags>(response));
}

export function deleteBookmark(id: string): Promise<void> {
  return api.api.bookmarks[':id']
    .$delete({ param: { id } })
    .then((response) => unwrap<void>(response));
}

export function assignTagToBookmark(bookmarkId: string, tagId: string): Promise<BookmarkWithTags> {
  return api.api.bookmarks[':id'].tags
    .$post({ param: { id: bookmarkId }, json: { tagId } })
    .then((response) => unwrap<BookmarkWithTags>(response));
}

export function removeTagFromBookmark(bookmarkId: string, tagId: string): Promise<void> {
  return api.api.bookmarks[':id'].tags[':tagId']
    .$delete({ param: { id: bookmarkId, tagId } })
    .then((response) => unwrap<void>(response));
}

export function setTagStatus(id: string, status: TagStatus): Promise<Tag> {
  return api.api.tags[':id'].status
    .$post({ param: { id }, json: { status } })
    .then((response) => unwrap<Tag>(response));
}

export function createTag(input: { name: string; categoryId?: string | null }): Promise<Tag> {
  return api.api.tags
    .$post({ json: { name: input.name, categoryId: input.categoryId ?? null } })
    .then((response) => unwrap<Tag>(response));
}

export function createCategory(input: { name: string }): Promise<Category> {
  return api.api.categories
    .$post({ json: { name: input.name } })
    .then((response) => unwrap<Category>(response));
}

export function acceptCandidate(bookmarkId: string, tagId: string): Promise<BookmarkWithTags> {
  return api.api.review.candidates.accept
    .$post({ json: { bookmarkId, tagId } })
    .then((response) => unwrap<BookmarkWithTags>(response));
}
