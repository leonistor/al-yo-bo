import type { Database } from 'bun:sqlite';

import {
  createCategory,
  createSection,
  createTag,
  deleteCategory,
  deleteSection,
  deleteTag,
  getBookmarksWithTagsByIds,
  getCategoryById,
  getCategoryByName,
  getSectionByName,
  getTagById,
  getTagByName,
  listBookmarkIdsForCategoryScope,
  listBookmarkIdsForTag,
  listCategories,
  listSections,
  listTags,
  setTagStatus,
  updateCategory,
  updateSection,
  updateTag,
} from '@al-yo-bo/db';
import type { Category, Section, Tag, TagStatus } from '@al-yo-bo/shared';

import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import type { JobScheduler } from './enrichment.ts';

export interface SectionInput {
  name: string;
  description?: string | null;
}

export interface SectionPatch {
  name?: string;
  description?: string | null;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  sectionId?: string | null;
}

export interface CategoryPatch {
  name?: string;
  description?: string | null;
  sectionId?: string | null;
}

export interface TagInput {
  name: string;
  description?: string | null;
  categoryId?: string | null;
}

export interface TagPatch {
  name?: string;
  description?: string | null;
  categoryId?: string | null;
}

export interface VocabularyServiceDeps {
  db: Database;
  jobs: JobScheduler;
  vector: VectorProvider;
  /** Dataset the vocabulary operations are scoped to. */
  datasetId: string;
}

export interface VocabularyService {
  listSections(): Section[];
  createSection(input: SectionInput): Section;
  updateSection(id: string, input: SectionPatch): Section;
  deleteSection(id: string): void;
  listCategories(): Category[];
  createCategory(input: CategoryInput): Category;
  updateCategory(id: string, input: CategoryPatch): Category;
  /** Async so the affected bookmarks' vector payloads can be resynced. */
  deleteCategory(id: string): Promise<void>;
  listTags(): Tag[];
  createTag(input: TagInput): Tag;
  updateTag(id: string, input: TagPatch): Tag;
  /** Async so the affected bookmarks' vector payloads can be resynced. */
  deleteTag(id: string): Promise<void>;
  /** Tag-only lifecycle hook: switch between `active` and `deprecated`. */
  setTagStatus(id: string, status: TagStatus): Tag;
}

/**
 * A tag's classification scope must stay inside its own dataset: a category from
 * another dataset would leak vocabulary across the boundary (MODEL.md
 * principle 1). Missing categories are NotFound; foreign ones are Validation.
 */
function assertCategoryInDataset(db: Database, categoryId: string, datasetId: string): void {
  const category = getCategoryById(db, categoryId);
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  if (category.datasetId !== datasetId) {
    throw new ValidationError('Category belongs to a different dataset');
  }
}

/**
 * Categories/sections/tags management, dataset-scoped. Sections and categories
 * are no longer gated by status — vocabulary is always created active, so the
 * service only exposes CRUD. Tags retain an `active`/`deprecated` toggle
 * because the classifier's candidate set (ARCHITECTURE §7) and the UI's tag
 * chips both react to it.
 */
export function createVocabularyService(deps: VocabularyServiceDeps): VocabularyService {
  const { db, jobs, vector, datasetId } = deps;

  /**
   * Mirrors a vocabulary delete into the denormalized vector payloads: the FK
   * cascade changes a bookmark's category/tag state immediately, but the index
   * still holds the old ids until a full reindex. Reads the post-delete state
   * and applies the shared sync rule (no-op on an empty index).
   */
  async function resyncBookmarkPayloads(bookmarkIds: string[]): Promise<void> {
    if (bookmarkIds.length === 0) {
      return;
    }
    for (const bookmark of getBookmarksWithTagsByIds(db, bookmarkIds)) {
      await syncVectorPayload(vector.current(), bookmark.id, bookmark);
    }
  }

  return {
    listSections() {
      return listSections(db, datasetId);
    },

    createSection(input) {
      // The db create is an idempotent upsert, so without this pre-check the UI
      // cannot tell "created" from "already existed"; renames collide with the
      // unique index and would otherwise surface as a raw 500.
      if (getSectionByName(db, datasetId, input.name)) {
        throw new ConflictError(`A section named "${input.name}" already exists`);
      }
      return createSection(db, {
        datasetId,
        name: input.name,
        description: input.description ?? null,
      });
    },

    updateSection(id, input) {
      if (input.name !== undefined) {
        const existing = getSectionByName(db, datasetId, input.name);
        if (existing && existing.id !== id) {
          throw new ConflictError(`A section named "${input.name}" already exists`);
        }
      }
      const updated = updateSection(db, id, {
        name: input.name,
        description: 'description' in input ? (input.description ?? null) : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Section not found');
      }
      return updated;
    },

    deleteSection(id) {
      if (!deleteSection(db, id)) {
        throw new NotFoundError('Section not found');
      }
    },

    listCategories() {
      return listCategories(db, datasetId);
    },

    createCategory(input) {
      if (getCategoryByName(db, datasetId, input.name)) {
        throw new ConflictError(`A category named "${input.name}" already exists`);
      }
      return createCategory(db, {
        datasetId,
        name: input.name,
        description: input.description ?? null,
        sectionId: input.sectionId ?? null,
      });
    },

    updateCategory(id, input) {
      if (input.name !== undefined) {
        const existing = getCategoryByName(db, datasetId, input.name);
        if (existing && existing.id !== id) {
          throw new ConflictError(`A category named "${input.name}" already exists`);
        }
      }
      const updated = updateCategory(db, id, {
        name: input.name,
        description: 'description' in input ? (input.description ?? null) : undefined,
        sectionId: 'sectionId' in input ? (input.sectionId ?? null) : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Category not found');
      }
      return updated;
    },

    async deleteCategory(id) {
      // Capture before the delete: the FK sets `bookmarks.category_id` to NULL,
      // so afterwards this query can no longer find the affected rows.
      const affected = listBookmarkIdsForCategoryScope(db, datasetId, id);
      if (!deleteCategory(db, id)) {
        throw new NotFoundError('Category not found');
      }
      await resyncBookmarkPayloads(affected);
    },

    listTags() {
      return listTags(db, datasetId);
    },

    createTag(input) {
      if (input.categoryId) {
        assertCategoryInDataset(db, input.categoryId, datasetId);
      }
      // Name uniqueness is scoped per (dataset, category) when the tag is
      // scoped, per dataset when unscoped; the db create hides that as an
      // idempotent upsert, so surface the collision explicitly here.
      if (getTagByName(db, datasetId, input.name, input.categoryId ?? null)) {
        throw new ConflictError(`A tag named "${input.name}" already exists`);
      }
      return createTag(db, {
        datasetId,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
      });
    },

    updateTag(id, input) {
      // The DB layer cannot reject a foreign `categoryId` without throwing a
      // transport-neutral error, so the boundary check lives here (SQL stays in
      // `@al-yo-bo/db`); the row's own dataset defines the allowed scope.
      const current =
        input.name !== undefined || ('categoryId' in input && Boolean(input.categoryId))
          ? getTagById(db, id)
          : null;
      if ('categoryId' in input && input.categoryId) {
        if (!current) {
          throw new NotFoundError('Tag not found');
        }
        assertCategoryInDataset(db, input.categoryId, current.datasetId);
      }
      if (input.name !== undefined && current) {
        // The collision scope is the *resulting* category, so a simultaneous
        // rename + re-scope is checked against the new scope, not the old one.
        const scopeCategoryId =
          'categoryId' in input ? (input.categoryId ?? null) : current.categoryId;
        const existing = getTagByName(db, current.datasetId, input.name, scopeCategoryId);
        if (existing && existing.id !== id) {
          throw new ConflictError(`A tag named "${input.name}" already exists`);
        }
      }
      const updated = updateTag(db, id, {
        name: input.name,
        description: 'description' in input ? (input.description ?? null) : undefined,
        categoryId: 'categoryId' in input ? (input.categoryId ?? null) : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Tag not found');
      }
      return updated;
    },

    async deleteTag(id) {
      // Capture before the delete: removing the tag cascades away its
      // `bookmark_tags` rows, erasing the only record of which bookmarks held it.
      const affected = listBookmarkIdsForTag(db, id);
      if (!deleteTag(db, id)) {
        throw new NotFoundError('Tag not found');
      }
      await resyncBookmarkPayloads(affected);
    },

    setTagStatus(id, status) {
      const previous = getTagById(db, id);
      if (!previous) {
        throw new NotFoundError('Tag not found');
      }
      const updated = setTagStatus(db, id, status);
      if (!updated) {
        throw new NotFoundError('Tag not found');
      }
      // Vocabulary change (§7 re-run triggers): activating a deprecated tag
      // makes it a candidate again -> re-classify the bookmarks in its scope.
      if (previous.status !== 'active' && status === 'active') {
        for (const bookmarkId of listBookmarkIdsForCategoryScope(
          db,
          datasetId,
          updated.categoryId,
        )) {
          jobs.enqueue(bookmarkId, 'classify');
        }
      }
      return updated;
    },
  };
}
