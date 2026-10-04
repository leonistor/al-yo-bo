import type { Database } from 'bun:sqlite';

import { bytesToUuid, uuidToBytes, type Category, type CategoryNode } from '@al-yo-bo/shared';

import { mapCategory, type CategoryRow } from '../row-mapping.ts';
import { lastOrder, orderAfter } from '../sort-order.ts';
import { newIdBytes } from '../uuid.ts';
import { requireVocabularyName } from '../vocab-validation.ts';
import { prepared } from './statements.ts';

/**
 * Category-tree CRUD (MODEL.md principle 2). Parenthood lives in the
 * `categories.parent_id` self-FK; sibling order in the app-generated
 * fractional `sort_order` key (src/sort-order.ts); sibling names are unique
 * via the two partial unique indexes (`categories_root_name_unique` /
 * `categories_child_name_unique`), so `web/2024` and `books/2024` coexist.
 *
 * Cycle integrity: SQL cannot express "not one of your own descendants" on a
 * self-FK, so `moveCategory` walks the ancestor chain in app code and refuses
 * any parent assignment that would close a cycle.
 */

const COLUMNS = 'id, parent_id, sort_order, name, description, created_at';

/**
 * Flat category list ordered for tree assembly: all roots first (NULL parent
 * group sorts first in SQLite ASC), then each parent group's children, every
 * sibling run ordered by `sort_order`. Iterating it and appending each row
 * under its parent preserves both root and sibling order without a re-sort.
 */
export function listCategories(db: Database): Category[] {
  return prepared<CategoryRow, []>(
    db,
    `SELECT ${COLUMNS} FROM categories ORDER BY parent_id, sort_order`,
  )
    .all()
    .map(mapCategory);
}

export function getCategoryById(db: Database, id: string): Category | null {
  const row = prepared<CategoryRow, [Uint8Array]>(
    db,
    `SELECT ${COLUMNS} FROM categories WHERE id = ?`,
  ).get(uuidToBytes(id));
  return row ? mapCategory(row) : null;
}

/**
 * Sibling-name lookup: the category called `name` under `parentId` (null =
 * among roots). The importer resolves paths through this; the two partial
 * unique indexes guarantee at most one match.
 */
export function getCategoryBySiblingName(
  db: Database,
  parentId: string | null,
  name: string,
): Category | null {
  const row = parentId
    ? prepared<CategoryRow, [Uint8Array, string]>(
        db,
        `SELECT ${COLUMNS} FROM categories WHERE parent_id = ? AND name = ?`,
      ).get(uuidToBytes(parentId), name)
    : prepared<CategoryRow, [string]>(
        db,
        `SELECT ${COLUMNS} FROM categories WHERE parent_id IS NULL AND name = ?`,
      ).get(name);
  return row ? mapCategory(row) : null;
}

/**
 * Assembles the nested tree the sidebar and MCP consume. Children are nested
 * under their parent in `sort_order` order (inherited from `listCategories`'s
 * flat ordering); roots are `parentId IS NULL` rows in their own sort order.
 */
export function getCategoryTree(db: Database): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const category of listCategories(db)) {
    nodes.set(category.id, { ...category, children: [] });
  }
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Ancestor chain of one category, root → node (the export path grammar,
 * ARCHITECTURE §7). A recursive CTE walks parent pointers upward; ordering by
 * descending depth puts the root first.
 */
export function listCategoryPath(db: Database, id: string): Category[] {
  return prepared<CategoryRow, [Uint8Array]>(
    db,
    `WITH RECURSIVE ancestors(id, parent_id, sort_order, name, description, created_at, depth) AS (
       SELECT id, parent_id, sort_order, name, description, created_at, 0
         FROM categories WHERE id = ?
       UNION ALL
       SELECT c.id, c.parent_id, c.sort_order, c.name, c.description, c.created_at, a.depth + 1
         FROM categories c
         JOIN ancestors a ON c.id = a.parent_id
     )
     SELECT id, parent_id, sort_order, name, description, created_at
       FROM ancestors ORDER BY depth DESC`,
  )
    .all(uuidToBytes(id))
    .map(mapCategory);
}

export interface CategoryInput {
  name: string;
  parentId?: string | null;
  description?: string | null;
  /** Explicit fractional key (drag-reorder); default appends after the last sibling. */
  sortOrder?: string;
}

/**
 * Creates a category as the last sibling under `parentId` (null = root),
 * unless an explicit `sortOrder` is given. Returns the existing category when
 * the sibling name is taken — the merge-by-name behavior the importer relies
 * on; UI callers that need a hard conflict surface it as a no-op + read-back.
 */
export function createCategory(db: Database, input: CategoryInput): Category {
  const name = requireVocabularyName('category', input.name);
  const run = db.transaction(() => {
    const parentId = input.parentId ?? null;
    const existing = getCategoryBySiblingName(db, parentId, name);
    if (existing) {
      return existing;
    }
    const sortOrder = input.sortOrder ?? appendSortOrder(db, parentId);
    const id = newIdBytes();
    prepared(
      db,
      `INSERT INTO categories (id, parent_id, sort_order, name, description)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      parentId ? uuidToBytes(parentId) : null,
      sortOrder,
      name,
      input.description ?? null,
    );
    const created = getCategoryById(db, bytesToUuid(id));
    if (!created) {
      throw new Error('Category insert did not persist');
    }
    return created;
  });
  return run.immediate();
}

/** Next key at the end of a sibling list: midpoint after the current tail. */
function appendSortOrder(db: Database, parentId: string | null): string {
  const parentBytes = parentId ? uuidToBytes(parentId) : null;
  const tail = parentBytes
    ? prepared<{ sort_order: string }, [Uint8Array]>(
        db,
        'SELECT sort_order FROM categories WHERE parent_id = ? ORDER BY sort_order DESC LIMIT 1',
      ).get(parentBytes)
    : prepared<{ sort_order: string }, []>(
        db,
        'SELECT sort_order FROM categories WHERE parent_id IS NULL ORDER BY sort_order DESC LIMIT 1',
      ).get();
  return tail ? orderAfter(tail.sort_order) : lastOrder();
}

export interface CategoryPatch {
  name?: string;
  description?: string | null;
}

/**
 * Renames / re-describes a category. Renaming into a sibling's name violates
 * the partial unique index and throws (SQLite constraint error) — the API
 * layer maps that to a conflict response.
 */
export function updateCategory(db: Database, id: string, patch: CategoryPatch): Category | null {
  const current = getCategoryById(db, id);
  if (!current) {
    return null;
  }
  prepared(db, 'UPDATE categories SET name = ?, description = ? WHERE id = ?').run(
    patch.name ?? current.name,
    patch.description === undefined ? current.description : patch.description,
    uuidToBytes(id),
  );
  return getCategoryById(db, id);
}

/** Error thrown when a move would make a category its own descendant. */
export class CategoryCycleError extends Error {
  constructor(categoryId: string, parentId: string) {
    super(`Cannot move category ${categoryId} under ${parentId}: would create a cycle`);
    this.name = 'CategoryCycleError';
  }
}

/**
 * Re-parents a category (subtree included — children follow implicitly).
 * The cycle check walks the target's ancestor chain: if the moved category
 * appears anywhere on it, the move would make it its own descendant and is
 * refused (MODEL.md "Tree integrity"). The moved category becomes the last
 * sibling under its new parent; use an explicit `sortOrder` (from a
 * drag-reorder) to place it precisely. A sibling name clash under the target
 * parent surfaces as the unique-index error.
 */
export function moveCategory(
  db: Database,
  id: string,
  parentId: string | null,
  sortOrder?: string,
): Category | null {
  const current = getCategoryById(db, id);
  if (!current) {
    return null;
  }
  if (parentId) {
    if (parentId === id) {
      throw new CategoryCycleError(id, parentId);
    }
    // Walk up from the target parent; reaching the moved category means the
    // target sits inside the moved subtree.
    let ancestorId: string | null = parentId;
    while (ancestorId) {
      if (ancestorId === id) {
        throw new CategoryCycleError(id, parentId);
      }
      const ancestor = prepared<{ parent_id: Uint8Array | null }, [Uint8Array]>(
        db,
        'SELECT parent_id FROM categories WHERE id = ?',
      ).get(uuidToBytes(ancestorId));
      ancestorId = ancestor?.parent_id ? bytesToUuid(ancestor.parent_id) : null;
    }
  }
  const key = sortOrder ?? appendSortOrder(db, parentId);
  prepared(db, 'UPDATE categories SET parent_id = ?, sort_order = ? WHERE id = ?').run(
    parentId ? uuidToBytes(parentId) : null,
    key,
    uuidToBytes(id),
  );
  return getCategoryById(db, id);
}

export interface CategorySubtreeInfo {
  /** Categories removed, including the deleted one (children cascade). */
  categories: number;
  /** Bookmarks whose `category_id` pointed into the subtree (they survive, SET NULL). */
  bookmarks: number;
}

/**
 * Recursive CTE matching a category subtree (single bound parameter: the root
 * id). Fixed SQL, one param: safe for the prepared-statement cache, so the
 * bookmark category filter expands server-side — a parent-category filter
 * matches bookmarks shelved anywhere beneath it (MODEL.md principle 2, the
 * sidebar's tree semantics) instead of shipping variable id lists through the
 * IN-clause chunking path.
 */
const SUBTREE_CTE = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM categories WHERE id = ?
  UNION ALL
  SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
)`;

/** Fragment to append after a column: `category_id ${CATEGORY_SUBTREE_IN}` with the root id bound. */
export const CATEGORY_SUBTREE_IN = `IN (${SUBTREE_CTE} SELECT id FROM subtree)`;

/** Counts what `deleteCategory` would remove (the UI's confirmation numbers). */
export function getCategorySubtreeInfo(db: Database, id: string): CategorySubtreeInfo {
  const categories = prepared<{ n: number }, [Uint8Array]>(
    db,
    `SELECT COUNT(*) AS n FROM (${SUBTREE_CTE} SELECT id FROM subtree)`,
  ).get(uuidToBytes(id))!.n;
  const bookmarks = prepared<{ n: number }, [Uint8Array]>(
    db,
    `SELECT COUNT(*) AS n FROM bookmarks WHERE category_id ${CATEGORY_SUBTREE_IN}`,
  ).get(uuidToBytes(id))!.n;
  return { categories, bookmarks };
}

/**
 * Deletes a category and its subtree: children cascade via the self-FK and
 * every `bookmarks.category_id` pointing into the subtree is set to NULL —
 * bookmarks are content, not structure, so they survive (MODEL.md "Deletion
 * semantics"). Counts are taken before the delete because `run().changes` is
 * not reliable once triggers fire.
 */
export function deleteCategory(db: Database, id: string): CategorySubtreeInfo {
  const info = getCategorySubtreeInfo(db, id);
  const run = db.transaction(() => {
    prepared(db, 'DELETE FROM categories WHERE id = ?').run(uuidToBytes(id));
  });
  run.immediate();
  return info;
}

export function countCategories(db: Database): number {
  return (
    prepared<{ count: number }, []>(db, 'SELECT COUNT(*) AS count FROM categories').get()?.count ??
    0
  );
}
