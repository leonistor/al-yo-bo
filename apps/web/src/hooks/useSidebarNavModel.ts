import { useMemo } from 'react';
import type { Aggregates, CategoryNode, TagAggregate } from '@al-yo-bo/shared';

import { directCountMap, subtreeCountMap } from '@/lib/categories';

export interface SidebarNavModel {
  /** The category tree (roots and children in fractional `sortOrder` order). */
  tree: CategoryNode[];
  /** Subtree bookmark counts per category id (node + all descendants). */
  categoryCounts: Map<string, number>;
  /** Top tags with at least one bookmark. */
  tags: TagAggregate[];
  /** Total bookmark count. */
  total: number;
  /** Number of non-empty tags shown. */
  tagCount: number;
  /** True when the "All" view is active. */
  isAllActive: boolean;
  /** True when any category is selected. */
  isCategoryActive: boolean;
  /** True when any tag is selected. */
  isTagActive: boolean;
}

/**
 * Shared derivation of the sidebar navigation model over the v2 category
 * tree (MODEL.md principle 2). Both the expanded/mobile nav and the collapsed
 * rail consume this so counts, filters, and active states stay in sync and
 * never drift apart.
 */
export function useSidebarNavModel(
  tree: CategoryNode[],
  aggregates: Aggregates | null,
  selectedCategoryId: string | null,
  selectedTagId: string | null,
): SidebarNavModel {
  return useMemo(() => {
    // Sidebar rows show subtree totals: a collapsed branch must still account
    // for the bookmarks inside it. Derived from the aggregates' direct counts.
    const counts = subtreeCountMap(tree, directCountMap(aggregates?.categories));
    // Deterministic order: the active tag floats to the top, then A–Z, before
    // the top-14 slice so selection never shifts out of the cloud.
    const tags =
      aggregates?.tags
        .filter((tag) => tag.count > 0)
        .toSorted((a, b) => {
          if (a.id === selectedTagId) return -1;
          if (b.id === selectedTagId) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 14) ?? [];

    return {
      tree,
      categoryCounts: counts,
      tags,
      total: aggregates?.total ?? 0,
      tagCount: tags.length,
      isAllActive: !selectedCategoryId && !selectedTagId,
      isCategoryActive: selectedCategoryId !== null,
      isTagActive: selectedTagId !== null,
    };
  }, [tree, aggregates, selectedCategoryId, selectedTagId]);
}
