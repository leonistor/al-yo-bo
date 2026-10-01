import type { Database } from 'bun:sqlite';

import {
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  getTagById,
  listBookmarkIdsForCategoryScope,
  listCategories,
  listTags,
  setTagStatus,
  updateCategory,
  updateTag,
} from '@al-yo-bo/db';
import type { Category, Tag, TagStatus } from '@al-yo-bo/shared';

import { NotFoundError } from '../errors.ts';
import type { JobScheduler } from './enrichment.ts';

export interface CategoryInput {
  name: string;
  description?: string | null;
}

export interface CategoryPatch {
  name?: string;
  description?: string | null;
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
}

export interface VocabularyService {
  listCategories(): Category[];
  createCategory(input: CategoryInput): Category;
  updateCategory(id: string, input: CategoryPatch): Category;
  deleteCategory(id: string): void;
  listTags(): Tag[];
  createTag(input: TagInput): Tag;
  updateTag(id: string, input: TagPatch): Tag;
  deleteTag(id: string): void;
  setTagStatus(id: string, status: TagStatus): Tag;
}

/**
 * Categories/tags management. The only behaviour beyond CRUD is the vocabulary
 * re-run trigger (ARCHITECTURE §7): activating a tag makes it a candidate again,
 * so every bookmark in its scope is re-classified.
 */
export function createVocabularyService(deps: VocabularyServiceDeps): VocabularyService {
  const { db, jobs } = deps;

  return {
    listCategories() {
      return listCategories(db);
    },

    createCategory(input) {
      return createCategory(db, { name: input.name, description: input.description ?? null });
    },

    updateCategory(id, input) {
      const updated = updateCategory(db, id, {
        name: input.name,
        description: 'description' in input ? (input.description ?? null) : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Category not found');
      }
      return updated;
    },

    deleteCategory(id) {
      if (!deleteCategory(db, id)) {
        throw new NotFoundError('Category not found');
      }
    },

    listTags() {
      return listTags(db);
    },

    createTag(input) {
      return createTag(db, {
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
      });
    },

    updateTag(id, input) {
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

    deleteTag(id) {
      if (!deleteTag(db, id)) {
        throw new NotFoundError('Tag not found');
      }
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
      // Vocabulary change (§7 re-run triggers): activating a tag makes it a
      // candidate again -> re-classify the bookmarks in its scope.
      if (previous.status !== 'active' && status === 'active') {
        for (const bookmarkId of listBookmarkIdsForCategoryScope(db, updated.categoryId)) {
          jobs.enqueue(bookmarkId, 'classify');
        }
      }
      return updated;
    },
  };
}
