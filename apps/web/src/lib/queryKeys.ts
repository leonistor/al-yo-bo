import type { BookmarkSearchParams } from '@/lib/client';

/**
 * Centralized TanStack Query keys. Hierarchy matters: invalidating
 * `bookmarks.all` (or any parent prefix) refetches every list variant, while
 * individual `list` keys carry the full filter/pagination params. The SSE
 * hook (`lib/useEvents`) maps domain topics onto these prefixes (§9).
 */
export const queryKeys = {
  bookmarks: {
    all: ['bookmarks'] as const,
    list: (params: BookmarkSearchParams) =>
      [...queryKeys.bookmarks.all, 'list', params] as const,
  },
  aggregates: ['aggregates'] as const,
  profile: ['profile'] as const,
  categories: ['categories'] as const,
  tags: ['tags'] as const,
  lan: ['lan'] as const,
  health: ['health'] as const,
};
