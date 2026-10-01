import type { Database } from 'bun:sqlite';

import {
  createCategory,
  createSection,
  createTag,
  deleteCategory,
  deleteSection,
  deleteTag,
  getTagById,
  listBookmarkIdsForCategoryScope,
  listCategories,
  listSections,
  listTags,
  setCategoryStatus,
  setSectionStatus,
  setTagStatus,
  updateCategory,
  updateSection,
  updateTag,
} from '@al-yo-bo/db';
import type { Category, CategoryStatus, Section, Tag, TagStatus } from '@al-yo-bo/shared';

import { NotFoundError } from '../errors.ts';
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
  /** Dataset the vocabulary operations are scoped to. */
  datasetId: string;
}

export interface VocabularyService {
  listSections(): Section[];
  createSection(input: SectionInput): Section;
  updateSection(id: string, input: SectionPatch): Section;
  deleteSection(id: string): void;
  setSectionStatus(id: string, status: 'active' | 'proposed' | 'rejected'): Section;
  listCategories(): Category[];
  createCategory(input: CategoryInput): Category;
  updateCategory(id: string, input: CategoryPatch): Category;
  deleteCategory(id: string): void;
  setCategoryStatus(id: string, status: CategoryStatus): Category;
  listTags(): Tag[];
  createTag(input: TagInput): Tag;
  updateTag(id: string, input: TagPatch): Tag;
  deleteTag(id: string): void;
  setTagStatus(id: string, status: TagStatus): Tag;
}

/**
 * Categories/sections/tags management, dataset-scoped. The only behaviour beyond
 * CRUD is the vocabulary re-run trigger (ARCHITECTURE §7): activating a tag
 * makes it a candidate again, so every bookmark in its scope is re-classified.
 */
export function createVocabularyService(deps: VocabularyServiceDeps): VocabularyService {
  const { db, jobs, datasetId } = deps;

  return {
    listSections() {
      return listSections(db, datasetId);
    },

    createSection(input) {
      return createSection(db, {
        datasetId,
        name: input.name,
        description: input.description ?? null,
      });
    },

    updateSection(id, input) {
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

    setSectionStatus(id, status) {
      const updated = setSectionStatus(db, id, status);
      if (!updated) {
        throw new NotFoundError('Section not found');
      }
      return updated;
    },

    listCategories() {
      return listCategories(db, datasetId);
    },

    createCategory(input) {
      return createCategory(db, {
        datasetId,
        name: input.name,
        description: input.description ?? null,
        sectionId: input.sectionId ?? null,
      });
    },

    updateCategory(id, input) {
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

    deleteCategory(id) {
      if (!deleteCategory(db, id)) {
        throw new NotFoundError('Category not found');
      }
    },

    setCategoryStatus(id, status) {
      const updated = setCategoryStatus(db, id, status);
      if (!updated) {
        throw new NotFoundError('Category not found');
      }
      return updated;
    },

    listTags() {
      return listTags(db, datasetId);
    },

    createTag(input) {
      return createTag(db, {
        datasetId,
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
