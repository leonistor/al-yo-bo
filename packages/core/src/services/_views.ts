import type { Database } from 'bun:sqlite';

import { getBookmarksWithTagsByIds } from '@al-yo-bo/db';
import type { BookmarkWithTags } from '@al-yo-bo/shared';

import { NotFoundError } from '../errors.ts';

/**
 * Shared bookmark projection helper. Keeping it in one place avoids the
 * bookmarks/review services drifting on how a "bookmark not found" is surfaced.
 */
export function bookmarkView(db: Database, id: string): BookmarkWithTags | null {
  const [view] = getBookmarksWithTagsByIds(db, [id]);
  return view ?? null;
}

export function bookmarkViewOrThrow(db: Database, id: string): BookmarkWithTags {
  const view = bookmarkView(db, id);
  if (!view) {
    throw new NotFoundError('Bookmark not found');
  }
  return view;
}
