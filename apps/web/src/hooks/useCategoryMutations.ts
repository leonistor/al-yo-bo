import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CategoryNode } from '@al-yo-bo/shared';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { moveCategory, reorderCategories } from '@/lib/client';
import { findNode, isSelfOrDescendant, reorderSiblingIds } from '@/lib/categories';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Category tree mutations with optimistic updates (MODEL.md principle 2).
 *
 * Both operations rewrite `queryKeys.categories` in place, optimistically and
 * synchronously, so a drag never flickers; `onError` restores the snapshot
 * taken in `onMutate`. The server rebalances the fractional keys and emits
 * `categories.changed`, whose SSE invalidation (lib/useEvents) then converges
 * any drift between the client's predicted tree and the stored one.
 */

/** Rebuilds a tree so `dragId` becomes a child of `parentId` (null = root), appended last. */
function reparentTree(nodes: CategoryNode[], dragId: string, parentId: string | null): CategoryNode[] {
  const dragged = findNode(nodes, dragId);
  if (!dragged) {
    return nodes;
  }

  const strip = (list: CategoryNode[]): CategoryNode[] =>
    list.flatMap((node) => {
      if (node.id === dragId) {
        return [];
      }
      return [{ ...node, children: strip(node.children) }];
    });

  const attach = (list: CategoryNode[]): CategoryNode[] => {
    if (parentId === null) {
      return [...list, { ...dragged, parentId: null }];
    }
    return list.map((node) =>
      node.id === parentId
        ? { ...node, children: [...node.children, { ...dragged, parentId }] }
        : { ...node, children: attach(node.children) },
    );
  };

  return attach(strip(nodes));
}

/** Applies a full sibling-list order to the tree level identified by `parentId` (null = roots). */
function applySiblingOrder(
  nodes: CategoryNode[],
  parentId: string | null,
  orderedIds: string[],
): CategoryNode[] {
  const sortLevel = (list: CategoryNode[]): CategoryNode[] => {
    const byId = new Map(list.map((node) => [node.id, node]));
    if (byId.size !== orderedIds.length || !orderedIds.every((id) => byId.has(id))) {
      // Not this level (or a stale order): recurse instead of corrupting it.
      return list.map((node) => ({ ...node, children: sortLevel(node.children) }));
    }
    const ordered: CategoryNode[] = [];
    for (const id of orderedIds) {
      const node = byId.get(id);
      if (node) {
        ordered.push({ ...node, children: sortLevel(node.children) });
      }
    }
    return ordered;
  };

  if (parentId === null) {
    return sortLevel(nodes);
  }
  return nodes.map((node) =>
    node.id === parentId
      ? { ...node, children: sortLevel(node.children) }
      : { ...node, children: applySiblingOrder(node.children, parentId, orderedIds) },
  );
}

/** Fires after a successful tree write; SSE `categories.changed` also covers this. */
function invalidateAfterTreeWrite(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
  void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
}

export function useCategoryMutations() {
  const queryClient = useQueryClient();

  const move = useMutation({
    mutationFn: async ({ dragId, parentId }: { dragId: string; parentId: string | null }) => {
      await moveCategory(dragId, parentId);
    },
    onMutate: async ({ dragId, parentId }) => {
      const previous = queryClient.getQueryData<CategoryNode[]>(queryKeys.categories);
      if (previous) {
        const dragged = findNode(previous, dragId);
        // Cycle guard (MODEL.md principle 2): a category can never move into
        // its own subtree; the server re-checks, the client never shows it.
        const legal =
          dragged !== null &&
          (parentId === null ||
            (dragId !== parentId && !isSelfOrDescendant(dragged, parentId)));
        if (legal) {
          queryClient.setQueryData(queryKeys.categories, reparentTree(previous, dragId, parentId));
        }
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.categories, context.previous);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to move category');
    },
    onSettled: () => invalidateAfterTreeWrite(queryClient),
  });

  const reorder = useMutation({
    mutationFn: async ({
      parentId,
      orderedIds,
    }: {
      parentId: string | null;
      orderedIds: string[];
    }) => {
      await reorderCategories(parentId, orderedIds);
    },
    onMutate: async ({ parentId, orderedIds }) => {
      const previous = queryClient.getQueryData<CategoryNode[]>(queryKeys.categories);
      if (previous) {
        queryClient.setQueryData(
          queryKeys.categories,
          applySiblingOrder(previous, parentId, orderedIds),
        );
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.categories, context.previous);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to reorder categories');
    },
    onSettled: () => invalidateAfterTreeWrite(queryClient),
  });

  return { move, reorder };
}

/**
 * Drop handler shared by the sidebar and vocabulary trees: `into` sends a
 * move (drop onto the row), `before`/`after` send a full sibling-list reorder
 * (drop between rows). Guards against no-op drops on the dragged row itself
 * and against reorders across different parents.
 */
export function useCategoryDropHandler() {
  const { move, reorder } = useCategoryMutations();

  const handleDrop = useCallback(
    (
      nodes: CategoryNode[],
      dragId: string,
      targetId: string,
      position: 'before' | 'after' | 'into',
    ) => {
      if (dragId === targetId) {
        return;
      }
      if (position === 'into') {
        move.mutate({ dragId, parentId: targetId });
        return;
      }
      const dragged = findNode(nodes, dragId);
      const target = findNode(nodes, targetId);
      if (!dragged || !target || dragged.parentId !== target.parentId) {
        // A cross-parent drop is a move, not a reorder; only same-parent
        // placements map onto one sibling-list reorder.
        return;
      }
      const parentId = target.parentId;
      const siblings = parentId === null ? nodes : (findNode(nodes, parentId)?.children ?? []);
      reorder.mutate({
        parentId,
        orderedIds: reorderSiblingIds(siblings, dragId, targetId, position),
      });
    },
    [move, reorder],
  );

  /** Drops a category at the end of the root level (the "drop to root" strip). */
  const handleDropToRoot = useCallback(
    (nodes: CategoryNode[], dragId: string) => {
      if (nodes.some((node) => node.id === dragId)) {
        // Already a root: nothing to move.
        return;
      }
      move.mutate({ dragId, parentId: null });
    },
    [move],
  );

  return { handleDrop, handleDropToRoot };
}
