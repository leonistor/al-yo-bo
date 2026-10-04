import type { CategoryAggregate, CategoryNode } from '@al-yo-bo/shared';

/**
 * Category-tree helpers for the v2 model (MODEL.md principle 2): an
 * unlimited-depth tree with fractional `sortOrder` sibling keys. The server
 * returns `CategoryNode[]` (nested, roots and children ordered by
 * `sortOrder`); everything here is pure client-side derivation over that
 * shape, so the sidebar, vocabulary page, and selects share one grammar.
 */

/** A flattened tree entry for select-style surfaces (add/detail/export/palette). */
export interface CategoryOption {
  id: string;
  /** Leaf name, e.g. `2024`. */
  name: string;
  /** Full ancestor-chain label, e.g. `dev ▸ web` (the one path grammar, ARCHITECTURE §7). */
  path: string;
}

/**
 * Depth-first flatten of the tree in render order. `path` is the ancestor
 * chain joined with `▸` — selects display it so `web/2024` and `books/2024`
 * stay distinguishable now that names are only sibling-unique.
 */
export function flattenCategoryTree(nodes: CategoryNode[], prefix = ''): CategoryOption[] {
  const options: CategoryOption[] = [];
  for (const node of nodes) {
    const path = prefix === '' ? node.name : `${prefix} ▸ ${node.name}`;
    options.push({ id: node.id, name: node.name, path });
    if (node.children.length > 0) {
      options.push(...flattenCategoryTree(node.children, path));
    }
  }
  return options;
}

/** The `{ [id]: label }` items map base-ui's Select consumes. */
export function categoryOptionItems(options: CategoryOption[]): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option.id, option.path]));
}

/** Direct (non-subtree) bookmark count per category id from the aggregates payload. */
export function directCountMap(aggregates: CategoryAggregate[] | undefined): Map<string, number> {
  return new Map(aggregates?.map((category) => [category.id, category.count]) ?? []);
}

/**
 * Subtree bookmark counts: every node's own count plus all descendants'.
 * The sidebar and the delete confirm dialog show these — a collapsed branch's
 * number must account for what is inside it.
 */
export function subtreeCountMap(
  nodes: CategoryNode[],
  direct: Map<string, number>,
): Map<string, number> {
  const totals = new Map<string, number>();
  const walk = (node: CategoryNode): number => {
    let sum = direct.get(node.id) ?? 0;
    for (const child of node.children) {
      sum += walk(child);
    }
    totals.set(node.id, sum);
    return sum;
  };
  for (const node of nodes) {
    walk(node);
  }
  return totals;
}

/** Depth-first search for one node anywhere in the tree. */
export function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Whether `candidate` is `root` itself or one of its descendants (cycle guard for moves). */
export function isSelfOrDescendant(root: CategoryNode, candidateId: string): boolean {
  if (root.id === candidateId) {
    return true;
  }
  return root.children.some((child) => isSelfOrDescendant(child, candidateId));
}

/** Where a dragged row landed relative to a target row. */
export type DropPosition = 'before' | 'after' | 'into';

/**
 * Maps a pointer's vertical position over a row to a drop semantics:
 * outer thirds reorder before/after the target; the middle third nests
 * *into* it (become a child). The fractions give the thin reorder zones a
 * generous middle target, which is the operation that has no other affordance.
 */
export function dropPositionFromEvent(event: React.DragEvent<Element>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = (event.clientY - rect.top) / rect.height;
  if (offset < 1 / 3) {
    return 'before';
  }
  if (offset > 2 / 3) {
    return 'after';
  }
  return 'into';
}

/**
 * Computes the `orderedIds[]` payload for `POST /api/categories/reorder` when
 * a dragged sibling is placed before/after a target in one sibling list.
 * The server rewrites the list's fractional keys from this order (MODEL.md
 * principle 2); the client only ever ships the full sibling order.
 */
export function reorderSiblingIds(
  siblings: CategoryNode[],
  dragId: string,
  targetId: string,
  position: Extract<DropPosition, 'before' | 'after'>,
): string[] {
  const rest = siblings.filter((sibling) => sibling.id !== dragId);
  const index = rest.findIndex((sibling) => sibling.id === targetId);
  if (index === -1) {
    return rest.map((sibling) => sibling.id);
  }
  const insertAt = position === 'before' ? index : index + 1;
  return [
    ...rest.slice(0, insertAt).map((sibling) => sibling.id),
    dragId,
    ...rest.slice(insertAt).map((sibling) => sibling.id),
  ];
}
