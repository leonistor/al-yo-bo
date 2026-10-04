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
}

/**
 * Tags + the category tree (MODEL.md principle 2): categories are an orderable,
 * sibling-unique tree; tags are one flat global namespace with an
 * `active ⇄ deprecated` lifecycle that gates the classifier's candidate set
 * (ARCHITECTURE §7 stage 0). The legacy scoped-tag logic is gone — tags have no
 * category anymore. Every mutation emits the coarse `categories.changed` /
 * `tags.changed` events (ARCHITECTURE §9/H5).
 */
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
      // The db create is an idempotent sibling-name merge, so without this
      // pre-check the UI cannot tell "created" from "already existed"; the
      // two partial unique indexes (roots / children) are what backs this up.
      if (getCategoryBySiblingName(db, input.parentId ?? null, input.name)) {
        throw new ConflictError(`A category named "${input.name}" already exists there`);
      }
      const category = createCategory(db, {
        name: input.name,
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
        throw error;
      }
      if (!moved) {
        throw new NotFoundError('Category not found');
      }
      events.emit({ topic: 'categories.changed' });
      return moved;
    },

    reorderCategories(parentId, orderedIds) {
      const seen = new Set<string>();
      const currentKeys: string[] = [];
      for (const id of orderedIds) {
        if (seen.has(id)) {
          throw new ValidationError(`Duplicate category id in reorder list: ${id}`);
        }
        seen.add(id);
        const category = getCategoryById(db, id);
        if (!category) {
          throw new NotFoundError('Category not found');
        }
        if ((category.parentId ?? null) !== (parentId ?? null)) {
          throw new ValidationError('Reordered categories must share the same parent');
        }
        currentKeys.push(category.sortOrder);
      }
      // Evenly spaced keys over a fresh span: deterministic, every gap keeps
      // midpoints free, and the head keeps room below (`orderBefore` still
      // works — db/sort-order.ts). A full-list reorder is the documented
      // rebalance path; per-drag midpoint keys go through `moveCategory`.
      const keys = rebalanceSiblings(currentKeys);
      orderedIds.forEach((id, index) => {
        moveCategory(db, id, parentId, keys[index]);
      });
      events.emit({ topic: 'categories.changed' });
      return orderedIds
        .map((id) => getCategoryById(db, id))
        .filter((category): category is Category => category !== null);
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
      // Tag names are globally unique (MODEL.md); the db create is an
      // idempotent merge, so surface the collision explicitly for the UI.
      if (getTagByName(db, input.name)) {
        throw new ConflictError(`A tag named "${input.name}" already exists`);
      }
      // Tags are created `active` (vocabulary is created in its usable state,
      // MODEL.md principle 3) — a state input would contradict the lifecycle.
      const tag = createTag(db, {
        name: input.name,
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
  };
}
