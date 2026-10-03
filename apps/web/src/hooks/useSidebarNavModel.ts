import { useMemo } from 'react';
import type { Aggregates, CategoryAggregate, TagAggregate } from '@al-yo-bo/shared';

export interface SidebarNavModel {
  /** Categories with at least one bookmark. */
  categories: CategoryAggregate[];
  /** Top tags with at least one bookmark. */
  tags: TagAggregate[];
  /** Sections with at least one bookmark. */
  sections: NonNullable<Aggregates['sections']>;
  /** Categories not belonging to any section. */
  uncategorized: CategoryAggregate[];
  /** Total bookmark count. */
  total: number;
  /** Pending review count. */
  reviewCount: number;
  /** Number of non-empty categories. */
  categoryCount: number;
  /** Number of displayed tags. */
  tagCount: number;
  /** True when the "All" view is active. */
  isAllActive: boolean;
  /** True when the review queue is active. */
  isReviewActive: boolean;
  /** True when any category is selected. */
  isCategoryActive: boolean;
  /** True when any tag is selected. */
  isTagActive: boolean;
}

/**
 * Shared derivation of the sidebar navigation model. Both the expanded/mobile
 * nav tree and the collapsed rail consume this so counts, filters, and active
 * states stay in sync and never drift apart.
 */
export function useSidebarNavModel(
  aggregates: Aggregates | null,
  view: 'library' | 'review',
  selectedCategoryId: string | null,
  selectedTagId: string | null,
  reviewCount: number,
): SidebarNavModel {
  return useMemo(() => {
    const categories = aggregates?.categories.filter((category) => category.count > 0) ?? [];
    const tags = aggregates?.tags.filter((tag) => tag.count > 0).slice(0, 14) ?? [];
    const sections = aggregates?.sections.filter((section) => section.count > 0) ?? [];
    const uncategorized = categories.filter((category) => category.sectionId === null);

    return {
      categories,
      tags,
      sections,
      uncategorized,
      total: aggregates?.total ?? 0,
      reviewCount,
      categoryCount: categories.length,
      tagCount: tags.length,
      isAllActive: view === 'library' && !selectedCategoryId && !selectedTagId,
      isReviewActive: view === 'review',
      isCategoryActive: view === 'library' && selectedCategoryId !== null,
      isTagActive: view === 'library' && selectedTagId !== null,
    };
  }, [aggregates, view, selectedCategoryId, selectedTagId, reviewCount]);
}
