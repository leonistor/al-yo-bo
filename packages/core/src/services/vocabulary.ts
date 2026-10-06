import type { Database } from 'bun:sqlite';

import {
  CategoryCycleError,
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  getBookmarksWithTagsByIds,
  getCategoryBySiblingName,
  getCategoryById,
  getCategorySubtreeInfo,
  getCategoryTree,
  getTagById,
  getTagByName,
  listBookmarkIdsForTag,
  listBookmarksForExport,
  listCategories,
  listTags,
  moveCategory,
  rebalanceSiblings,
  reorderSiblings,
  setTagStatus,
  updateCategory,
  updateTag,
  type CategorySubtreeInfo,
} from '@al-yo-bo/db';
import type { Category, CategoryNode, Tag, TagStatus } from '@al-yo-bo/shared';

import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import type { EventsSink } from '../events.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import type { JobScheduler } from './enrichment.ts';

export interface CategoryInput {
  name: string;
  parentId?: string | null;
  description?: string | null;
}

export interface CategoryPatch {
  name?: string;
  description?: string | null;
}

export interface TagInput {
  name: string;
  description?: string | null;
}

export interface TagPatch {
  name?: string;
  description?: string | null;
}

export interface BulkVocabularyInput {
  tags: { name: string; description?: string }[];
  categories: { path: string[]; description?: string }[];
}

export interface BulkVocabularyReport {
  tagsCreated: number;
  categoriesCreated: number;
  tags: Tag[];
  categories: Category[];
}
export interface VocabularyServiceDeps {
  db: Database;
  jobs: JobScheduler;
  vector: VectorProvider;
  events: EventsSink;
}

export interface VocabularyService {
  listCategories(): Category[];
  /** The nested tree the sidebar consumes (roots, then children in `sort_order`). */
  getCategoryTree(): CategoryNode[];
  createCategory(input: CategoryInput): Category;
  updateCategory(id: string, input: CategoryPatch): Category;
  /**
   * Re-parents a category (subtree included — children follow implicitly).
   * Cycles are refused here: the db move walks the ancestor chain and throws
   * `CategoryCycleError`, mapped to the transport-neutral validation error
   * (MODEL.md "Tree integrity" — SQL cannot express this on a self-FK).
   */
  moveCategory(id: string, parentId: string | null, sortOrder?: string): Category;
  /**
   * Persists a drag-reorder of one sibling list: `orderedIds` is the complete
   * list of sibling ids (all sharing `parentId`) in the desired order. Keys are
   * evenly spaced fractional values from db's `rebalanceSiblings` —
   * deterministic and gap-safe (MODEL.md principle 2, db/sort-order.ts). A
   * single-item drag that only needs a midpoint can pass an explicit
   * `sortOrder` to `moveCategory` instead.
   */
  reorderCategories(parentId: string | null, orderedIds: string[]): Category[];
  /** Counts a delete would remove — the confirmation UI's numbers. */
  subtreeInfo(id: string): CategorySubtreeInfo;
  /**
   * Deletes a category and its subtree; returns the counts the confirmation UI
   * showed. Bookmarks survive with `category_id` set to NULL (MODEL.md deletion
   * semantics).
   */
  deleteCategory(id: string): Promise<CategorySubtreeInfo>;
  listTags(): Tag[];
  createTag(input: TagInput): Tag;
  updateTag(id: string, input: TagPatch): Tag;
  deleteTag(id: string): Promise<void>;
  /** Tag-only lifecycle hook: switch between `active` and `deprecated`. */
  setTagStatus(id: string, status: TagStatus): Tag;
  /**
   * Idempotent batch creation for wizard-confirmed vocabulary. Tags and
   * category paths are merged by their existing names; new rows are created
   * active. Emits one `tags.changed` / `categories.changed` event each.
   */
  createBulk(input: BulkVocabularyInput): BulkVocabularyReport;
}

/**
 * Tags + the category tree (MODEL.md principle 2): categories are an orderable,
 * sibling-unique tree; tags are one flat global namespace with an
 * `active ⇄ deprecated` lifecycle that gates the classifier's candidate set
 * (ARCHITECTURE §7 stage 0). The legacy scoped-tag logic is gone — tags have no
 * category anymore. Every mutation emits the coarse `categories.changed` /
 * `tags.changed` events (ARCHITECTURE §9/H5).
 */
/**
 * db's sort-order primitives reject keys outside the alphabet with a raw
 * Error ("Invalid ... sort-order key", db/sort-order.ts). The HTTP edge only
 * checks non-empty, so a garbage `sortOrder` (or a garbage key already stored)
 * reaches the midpoint walk — it is caller input and maps to 400, not 500.
 */
function isSortOrderKeyError(error: Error): boolean {
  return /^Invalid .*sort-order key/.test(error.message);
}

export function createVocabularyService(deps: VocabularyServiceDeps): VocabularyService {
  const { db, jobs, vector, events } = deps;

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
      // Sequential on purpose: the vector adapter is not assumed to be
      // concurrency-safe, and a delete resync is small.
      // oxlint-disable-next-line no-await-in-loop
      await syncVectorPayload(vector.current(), bookmark.id, bookmark);
    }
  }

  /**
   * Ids of every bookmark shelved anywhere in a category's subtree, captured
   * BEFORE the delete (afterwards their `category_id` is NULL and the subtree
   * no longer resolves). `listBookmarksForExport` is the only uncapped
   * subtree-filtered read in `@al-yo-bo/db` — the paginated list would
   * silently truncate the resync at 100 rows.
   */
  function subtreeBookmarkIds(categoryId: string): string[] {
    return listBookmarksForExport(db, { categoryId }).map((bookmark) => bookmark.id);
  }

  /**
   * Resolves one category path root → leaf, creating any missing intermediate
   * categories. The leaf keeps the supplied description; intermediates are
   * created without one. Sibling-name merges are silent (idempotent bulk).
   */
  function resolveCategoryPath(
    path: string[],
    description?: string,
  ): { category: Category; createdCount: number } | null {
    let parentId: string | null = null;
    let leafId: string | null = null;
    let createdCount = 0;
    const segments = path.map((segment) => segment.trim()).filter((segment) => segment !== '');
    if (segments.length === 0) {
      return null;
    }
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index]!;
      const isLeaf = index === segments.length - 1;
      const existing = getCategoryBySiblingName(db, parentId, name);
      let id: string;
      if (existing) {
        id = existing.id;
      } else {
        const created = createCategory(db, {
          name,
          parentId,
          description: isLeaf ? (description ?? null) : null,
        });
        id = created.id;
        createdCount += 1;
      }
      parentId = id;
      if (isLeaf) {
        leafId = id;
      }
    }
    const category = leafId ? getCategoryById(db, leafId) : null;
    if (!category) {
      return null;
    }
    return { category, createdCount };
  }

  return {
    listCategories() {
      return listCategories(db);
    },

    getCategoryTree() {
      // db's flat ordering already puts roots first (shared NULL group) and
      // every sibling run in fractional-key order, so the assembled tree needs
      // no re-sort (packages/db listCategories contract).
      return getCategoryTree(db);
    },

    createCategory(input) {
      if (input.parentId && !getCategoryById(db, input.parentId)) {
        throw new NotFoundError('Parent category not found');
      }
      // Trim before the sibling-merge check so a stray `##  ` heading does not
      // become an empty row, and the trim in db's requireVocabularyName stays
      // consistent (the dedupe scope must use the same rule).
      const name = input.name.trim();
      if (name === '') {
        throw new ValidationError('Category name cannot be empty');
      }
      // The db create is an idempotent sibling-name merge, so without this
      // pre-check the UI cannot tell "created" from "already existed"; the
      // two partial unique indexes (roots / children) are what backs this up.
      if (getCategoryBySiblingName(db, input.parentId ?? null, name)) {
        throw new ConflictError(`A category named "${name}" already exists there`);
      }
      const category = createCategory(db, {
        name,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
      });
      events.emit({ topic: 'categories.changed' });
      return category;
    },

    updateCategory(id, input) {
      const current = getCategoryById(db, id);
      if (!current) {
        throw new NotFoundError('Category not found');
      }
      if (input.name !== undefined && input.name !== current.name) {
        // Sibling names are unique per parent (`web/2024` and `books/2024`
        // coexist), so the collision scope is the category's own parent.
        const existing = getCategoryBySiblingName(db, current.parentId, input.name);
        if (existing && existing.id !== id) {
          throw new ConflictError(`A category named "${input.name}" already exists there`);
        }
      }
      const updated = updateCategory(db, id, {
        name: input.name,
        description: 'description' in input ? (input.description ?? null) : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Category not found');
      }
      events.emit({ topic: 'categories.changed' });
      return updated;
    },

    moveCategory(id, parentId, sortOrder) {
      const current = getCategoryById(db, id);
      if (!current) {
        throw new NotFoundError('Category not found');
      }
      if (parentId && !getCategoryById(db, parentId)) {
        throw new NotFoundError('Parent category not found');
      }
      if (parentId && parentId !== current.parentId) {
        // The moved category keeps its name; a same-named sibling under the
        // target parent would violate the unique index with a raw SQLite
        // error — surface it as the domain conflict instead.
        const clash = getCategoryBySiblingName(db, parentId, current.name);
        if (clash && clash.id !== id) {
          throw new ConflictError(`A category named "${current.name}" already exists there`);
        }
      }
      let moved: Category | null;
      try {
        moved = moveCategory(db, id, parentId, sortOrder);
      } catch (error) {
        // App-layer tree integrity (MODEL.md): moving a category under its own
        // descendant would close a cycle; the db refuses and we map it.
        if (error instanceof CategoryCycleError) {
          throw new ValidationError('Cannot move a category under its own subtree');
        }
        if (error instanceof Error && isSortOrderKeyError(error)) {
          throw new ValidationError(error.message);
        }
        throw error;
      }
      if (!moved) {
        throw new NotFoundError('Category not found');
      }
      events.emit({ topic: 'categories.changed' });
      return moved;
    },

    reorderCategories(parentId, orderedIds) {
      // `reorderSiblings` runs validation + the N moveCategory updates in one
      // transaction so a mid-loop error never leaves the tree half-shuffled.
      // Map the raw db errors to the standard domain errors so the HTTP edge
      // returns the usual 4xx problem+json.
      let categories: Category[];
      try {
        categories = reorderSiblings(db, parentId, orderedIds, (currentKeys) =>
          // Evenly spaced keys over a fresh span: deterministic, every gap keeps
          // midpoints free, and the head keeps room below (`orderBefore` still
          // works — db/sort-order.ts). A full-list reorder is the documented
          // rebalance path; per-drag midpoint keys go through `moveCategory`.
          rebalanceSiblings(currentKeys),
        );
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.startsWith('Duplicate category id in reorder list')) {
            throw new ValidationError(error.message);
          }
          if (error.message === 'Category not found') {
            throw new NotFoundError(error.message);
          }
          if (error.message === 'Reordered categories must share the same parent') {
            throw new ValidationError(error.message);
          }
        }
        throw error;
      }
      events.emit({ topic: 'categories.changed' });
      return categories;
    },

    subtreeInfo(id) {
      if (!getCategoryById(db, id)) {
        throw new NotFoundError('Category not found');
      }
      return getCategorySubtreeInfo(db, id);
    },

    async deleteCategory(id) {
      if (!getCategoryById(db, id)) {
        throw new NotFoundError('Category not found');
      }
      const affected = subtreeBookmarkIds(id);
      const info = deleteCategory(db, id);
      await resyncBookmarkPayloads(affected);
      events.emit({ topic: 'categories.changed' });
      return info;
    },

    listTags() {
      return listTags(db);
    },

    createTag(input) {
      // Trim before the dedupe check for the same reason as createCategory
      // (importer `##  ` headings would otherwise leak empty rows).
      const name = input.name.trim();
      if (name === '') {
        throw new ValidationError('Tag name cannot be empty');
      }
      // Tag names are globally unique (MODEL.md); the db create is an
      // idempotent merge, so surface the collision explicitly for the UI.
      if (getTagByName(db, name)) {
        throw new ConflictError(`A tag named "${name}" already exists`);
      }
      // Tags are created `active` (vocabulary is created in its usable state,
      // MODEL.md principle 3) — a state input would contradict the lifecycle.
      const tag = createTag(db, {
        name,
        description: input.description ?? null,
      });
      events.emit({ topic: 'tags.changed' });
      return tag;
    },

    updateTag(id, input) {
      const current = getTagById(db, id);
      if (!current) {
        throw new NotFoundError('Tag not found');
      }
      if (input.name !== undefined && input.name !== current.name) {
        const existing = getTagByName(db, input.name);
        if (existing && existing.id !== id) {
          throw new ConflictError(`A tag named "${input.name}" already exists`);
        }
      }
      const updated = updateTag(db, id, {
        name: input.name,
        description: 'description' in input ? (input.description ?? null) : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Tag not found');
      }
      events.emit({ topic: 'tags.changed' });
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
      events.emit({ topic: 'tags.changed' });
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
      // Vocabulary change (§7 stage 6 re-run triggers): re-activating a tag
      // puts it back into the candidate set, and the candidate set is ALL
      // active tags (tags have no category), so the re-classify fan-out is the
      // whole library. The sequential queue dedupes per (bookmark, classify);
      // the cost is accepted at personal scale (§13 flags candidate-set growth).
      if (previous.status !== 'active' && status === 'active') {
        for (const bookmark of listBookmarksForExport(db, {})) {
          jobs.enqueue(bookmark.id, 'classify');
        }
      }
      events.emit({ topic: 'tags.changed' });
      return updated;
    },

    createBulk(input) {
      const report = db.transaction((): BulkVocabularyReport => {
        const result: BulkVocabularyReport = {
          tagsCreated: 0,
          categoriesCreated: 0,
          tags: [],
          categories: [],
        };

        for (const entry of input.tags) {
          const name = entry.name.trim();
          if (name === '') {
            continue;
          }
          const existed = getTagByName(db, name);
          const tag = createTag(db, { name, description: entry.description });
          if (!existed) {
            result.tagsCreated += 1;
          }
          result.tags.push(tag);
        }

        for (const entry of input.categories) {
          const resolved = resolveCategoryPath(entry.path, entry.description);
          if (!resolved) {
            continue;
          }
          result.categories.push(resolved.category);
          result.categoriesCreated += resolved.createdCount;
        }

        return result;
      }).immediate();

      if (input.tags.length > 0 || input.categories.length > 0) {
        events.emit({ topic: 'tags.changed' });
        events.emit({ topic: 'categories.changed' });
      }
      return report;
    },
  };
}
