import type { Database } from 'bun:sqlite';

import {
  assignTag as assignBookmarkTag,
  createBookmark,
  deleteBookmark,
  getBookmarkById,
  getBookmarksWithTagsByIds,
  getCategoryById,
  getTagById,
  removeBookmarkTag,
  updateBookmark,
  type BookmarkInput as DbBookmarkInput,
} from '@al-yo-bo/db';
import { isHttpUrl, isUuid, normalizeUrl, type BookmarkWithTags } from '@al-yo-bo/shared';

import { NotFoundError, ValidationError } from '../errors.ts';
import type { EventsSink } from '../events.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import { bookmarkViewOrThrow } from './_views.ts';
import type { JobScheduler } from './enrichment.ts';

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
  events: EventsSink;
}

export interface BookmarkService {
  get(id: string): BookmarkWithTags;
  create(input: BookmarkInput): BookmarkWithTags;
  update(id: string, input: BookmarkPatch): Promise<BookmarkWithTags>;
  delete(id: string): Promise<void>;
  assignTag(bookmarkId: string, tagId: string): Promise<BookmarkWithTags>;
  removeTag(bookmarkId: string, tagId: string): Promise<void>;
}

/** Categories are plain records in the one workspace — only existence is checked. */
function assertCategoryExists(db: Database, categoryId: string): void {
  if (!getCategoryById(db, categoryId)) {
    throw new NotFoundError('Category not found');
  }
}

/**
 * Bookmark CRUD plus its enrichment side effects. The re-run triggers live here
 * (ARCHITECTURE §7 stage 6): a URL change invalidates the old dead-link
 * evidence and re-scrapes, a title/description change re-embeds, and a category
 * move only shifts the vector payload filters. Content/vocabulary/model changes
 * re-run enrichment; every mutation emits the coarse `bookmarks.changed` event
 * (ARCHITECTURE §9/H5) whose payload is a hint (the affected id), never the
 * record.
 */
export function createBookmarkService(deps: BookmarkServiceDeps): BookmarkService {
  const { db, jobs, vector, events } = deps;

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
      if (input.categoryId) {
        assertCategoryExists(db, input.categoryId);
      }
      const bookmark = createBookmark(db, {
        url: input.url,
        title: input.title ?? null,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
      });
      jobs.enqueue(bookmark.id, 'scrape');
      events.emit({ topic: 'bookmarks.changed', bookmarkIds: [bookmark.id] });
      return bookmarkViewOrThrow(db, bookmark.id);
    },

    async update(id, input) {
      const current = getBookmarkById(db, id);
      if (!current) {
        throw new NotFoundError('Bookmark not found');
      }
      const patch: Partial<DbBookmarkInput> = {};
      if (input.url !== undefined) {
        // Same gate as `create` — without it normalizeUrl below would throw a
        // raw URL parse error for invalid input instead of a ValidationError.
        if (!isHttpUrl(input.url)) {
          throw new ValidationError('Only HTTP(S) URLs can be saved');
        }
        patch.url = input.url;
      }
      if ('title' in input) {
        patch.title = input.title ?? null;
      }
      if ('description' in input) {
        patch.description = input.description ?? null;
      }
      if ('categoryId' in input) {
        if (input.categoryId) {
          assertCategoryExists(db, input.categoryId);
        }
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
      // Content-bearing changes re-run the matching enrichment (§7 stage 6);
      // a category move only shifts the vector payload filters.
      if (updated.url !== current.url) {
        jobs.enqueue(id, 'scrape');
      } else if (updated.title !== current.title || updated.description !== current.description) {
        jobs.enqueue(id, 'embed');
      }
      if (updated.categoryId !== current.categoryId) {
        await syncPayload(id);
      }
      events.emit({ topic: 'bookmarks.changed', bookmarkIds: [id] });
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
      events.emit({ topic: 'bookmarks.changed', bookmarkIds: [id] });
    },

    async assignTag(bookmarkId, tagId) {
      const bookmark = getBookmarkById(db, bookmarkId);
      if (!bookmark) {
        throw new NotFoundError('Bookmark not found');
      }
      const tag = getTagById(db, tagId);
      if (!tag) {
        throw new NotFoundError('Tag not found');
      }
      // The vocabulary is one global namespace (MODEL.md principle 2): any
      // existing tag may attach to any bookmark.
      assignBookmarkTag(db, { bookmarkId, tagId, source: 'user' });
      await syncPayload(bookmarkId);
      events.emit({ topic: 'bookmarks.changed', bookmarkIds: [bookmarkId] });
      return bookmarkViewOrThrow(db, bookmarkId);
    },

    async removeTag(bookmarkId, tagId) {
      if (!isUuid(tagId) || !removeBookmarkTag(db, bookmarkId, tagId)) {
        throw new NotFoundError('Assignment not found');
      }
      await syncPayload(bookmarkId);
      events.emit({ topic: 'bookmarks.changed', bookmarkIds: [bookmarkId] });
    },
  };
}
