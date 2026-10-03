import type { Database } from 'bun:sqlite';

import {
  createCategory,
  createSection,
  createTag,
  deleteCategory,
  deleteSection,
  deleteTag,
  getCategoryById,
  getTagById,
  listBookmarkIdsForCategoryScope,
  listCategories,
  listSections,
  listTags,
  setTagStatus,
  updateCategory,
  updateSection,
  updateTag,
} from '@al-yo-bo/db';
import type { Category, Section, Tag, TagStatus } from '@al-yo-bo/shared';

import { NotFoundError, ValidationError } from '../errors.ts';
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
  listCategories(): Category[];
  createCategory(input: CategoryInput): Category;
  updateCategory(id: string, input: CategoryPatch): Category;
  deleteCategory(id: string): void;
  listTags(): Tag[];
  createTag(input: TagInput): Tag;
  updateTag(id: string, input: TagPatch): Tag;
  deleteTag(id: string): void;
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

    listTags() {
      return listTags(db, datasetId);
    },

    createTag(input) {
      if (input.categoryId) {
        assertCategoryInDataset(db, input.categoryId, datasetId);
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
      if ('categoryId' in input && input.categoryId) {
        const current = getTagById(db, id);
        if (!current) {
          throw new NotFoundError('Tag not found');
        }
        assertCategoryInDataset(db, input.categoryId, current.datasetId);
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
