import type { Database } from 'bun:sqlite';

import {
  assignTag as assignBookmarkTag,
  createBookmark,
  deleteBookmark,
  getBookmarkById,
  getBookmarksWithTagsByIds,
  getTagById,
  removeBookmarkTag,
  updateBookmark,
  type BookmarkInput as DbBookmarkInput,
} from '@al-yo-bo/db';
import {
  isHttpUrl,
  isUuid,
  normalizeUrl,
  type BookmarkWithTags,
} from '@al-yo-bo/shared';

import { NotFoundError, ValidationError } from '../errors.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import type { JobScheduler } from './enrichment.ts';
import { bookmarkViewOrThrow } from './_views.ts';

export interface BookmarkInput {
  url: string;
  title?: string | null;
  description?: string | null;
  categoryId?: string | null;
}

/** Only present keys are applied; `null` explicitly clears an optional field. */
export interface BookmarkPatch {
  url?: string;
  title?: string | null;
  description?: string | null;
  categoryId?: string | null;
}

export interface BookmarkServiceDeps {
  db: Database;
  jobs: JobScheduler;
  vector: VectorProvider;
}

export interface BookmarkService {
  get(id: string): BookmarkWithTags;
  create(input: BookmarkInput): BookmarkWithTags;
  update(id: string, input: BookmarkPatch): Promise<BookmarkWithTags>;
  delete(id: string): Promise<void>;
  assignTag(bookmarkId: string, tagId: string): Promise<BookmarkWithTags>;
  removeTag(bookmarkId: string, tagId: string): Promise<void>;
}

/**
 * Bookmark CRUD plus its enrichment side effects. The re-run triggers live here
 * (ARCHITECTURE §8): a URL change invalidates the old evidence and re-scrapes, a
 * title/description change re-embeds, and a category move only shifts the vector
 * payload filters. Everything else is passive.
 */
export function createBookmarkService(deps: BookmarkServiceDeps): BookmarkService {
  const { db, jobs, vector } = deps;

  async function syncPayload(bookmarkId: string): Promise<void> {
    const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
    await syncVectorPayload(vector.current(), bookmarkId, fresh);
  }

  return {
    get(id) {
      return bookmarkViewOrThrow(db, id);
    },

    create(input) {
      if (!isHttpUrl(input.url)) {
        throw new ValidationError('Only HTTP(S) URLs can be saved');
      }
      const bookmark = createBookmark(db, {
        url: input.url,
        title: input.title ?? null,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
      });
      jobs.enqueue(bookmark.id, 'scrape');
      return bookmarkViewOrThrow(db, bookmark.id);
    },

    async update(id, input) {
      const current = getBookmarkById(db, id);
      if (!current) {
        throw new NotFoundError('Bookmark not found');
      }
      const patch: Partial<DbBookmarkInput> = {};
      if (input.url !== undefined) {
        patch.url = input.url;
      }
      if ('title' in input) {
        patch.title = input.title ?? null;
      }
      if ('description' in input) {
        patch.description = input.description ?? null;
      }
      if ('categoryId' in input) {
        patch.categoryId = input.categoryId ?? null;
      }
      // A new URL gets a clean slate: old dead-link evidence no longer applies.
      if (patch.url !== undefined && normalizeUrl(patch.url) !== current.url) {
        patch.scrapeAttempts = 0;
        patch.status = 'active';
      }
      const updated = updateBookmark(db, id, patch);
      if (!updated) {
        throw new NotFoundError('Bookmark not found');
      }
      // Content-bearing changes re-run the matching enrichment (§8 re-run triggers);
      // a category move only shifts the vector payload filters.
      if (updated.url !== current.url) {
        jobs.enqueue(id, 'scrape');
      } else if (updated.title !== current.title || updated.description !== current.description) {
        jobs.enqueue(id, 'embed');
      }
      if (updated.categoryId !== current.categoryId) {
        await syncPayload(id);
      }
      return bookmarkViewOrThrow(db, id);
    },

    async delete(id) {
      if (!deleteBookmark(db, id)) {
        throw new NotFoundError('Bookmark not found');
      }
      // SQLite cascaded the embedding row; mirror the removal into the index.
      const index = vector.current();
      if (index.size > 0) {
        await index.delete(id);
      }
    },

    async assignTag(bookmarkId, tagId) {
      if (!getBookmarkById(db, bookmarkId)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!getTagById(db, tagId)) {
        throw new NotFoundError('Tag not found');
      }
      assignBookmarkTag(db, { bookmarkId, tagId, source: 'user' });
      await syncPayload(bookmarkId);
      return bookmarkViewOrThrow(db, bookmarkId);
    },

    async removeTag(bookmarkId, tagId) {
      if (!isUuid(tagId) || !removeBookmarkTag(db, bookmarkId, tagId)) {
        throw new NotFoundError('Assignment not found');
      }
      await syncPayload(bookmarkId);
    },
  };
}
