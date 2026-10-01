import type { BookmarkWithTags, VectorIndex } from '@al-yo-bo/shared';

/**
 * Single implementation of the payload-sync rule, replacing the duplicated
 * helpers in the server's app.ts (`syncVectorPayload`) and classify.ts
 * (`syncPayload`).
 *
 * The vector index mirrors a bookmark's filterable state (category + effective
 * tag ids). When the bookmark no longer exists the point must be removed; when
 * the index is empty there is nothing to update. Callers pass the freshly read
 * `bookmark` (or `undefined` when it is gone) so this stays free of db access.
 */
export async function syncVectorPayload(
  vector: VectorIndex,
  bookmarkId: string,
  bookmark: BookmarkWithTags | undefined,
): Promise<void> {
  if (vector.size === 0) {
    return;
  }
  if (!bookmark) {
    await vector.delete(bookmarkId);
    return;
  }
  await vector.updatePayload(bookmarkId, {
    categoryId: bookmark.categoryId,
    tagIds: bookmark.tags.map((tag) => tag.tagId),
  });
}
