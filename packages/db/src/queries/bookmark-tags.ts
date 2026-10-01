import type { Database } from 'bun:sqlite';

import {
  bytesToUuid,
  newIdBytes,
  uuidToBytes,
  type AssignmentSource,
  type BookmarkTagView,
} from '@al-yo-bo/shared';

import { mapBookmarkTag, type BookmarkTagRow } from '../row-mapping.ts';
import { prepared } from './statements.ts';

export interface AssignTagInput {
  bookmarkId: string;
  tagId: string;
  source: AssignmentSource;
  confidence?: number | null;
  runId?: string | null;
}

/**
 * Upserts an effective assignment. User-sourced rows are never overwritten by a
 * classifier or import run (MODEL.md: "User rows win").
 */
export function assignTag(db: Database, input: AssignTagInput): void {
  const existing = prepared<{ source: string }, [Uint8Array, Uint8Array]>(
    db,
    'SELECT source FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?',
  ).get(uuidToBytes(input.bookmarkId), uuidToBytes(input.tagId));

  if (existing && existing.source === 'user' && input.source !== 'user') {
    return;
  }

  prepared(
    db,
    `INSERT INTO bookmark_tags (id, bookmark_id, tag_id, source, confidence, run_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (bookmark_id, tag_id) DO UPDATE SET
       source = excluded.source,
       confidence = excluded.confidence,
       run_id = excluded.run_id`,
  ).run(
    newIdBytes(),
    uuidToBytes(input.bookmarkId),
    uuidToBytes(input.tagId),
    input.source,
    input.confidence ?? null,
    input.runId ? uuidToBytes(input.runId) : null,
  );
}

export function removeBookmarkTag(db: Database, bookmarkId: string, tagId: string): boolean {
  const result = prepared(db, 'DELETE FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?').run(
    uuidToBytes(bookmarkId),
    uuidToBytes(tagId),
  );
  return result.changes > 0;
}

export function getBookmarkTags(db: Database, bookmarkId: string): BookmarkTagView[] {
  return prepared<BookmarkTagRow, [Uint8Array]>(
    db,
    `SELECT bt.tag_id, t.name, bt.source, bt.confidence
         FROM bookmark_tags bt
         JOIN tags t ON t.id = bt.tag_id
        WHERE bt.bookmark_id = ?
        ORDER BY t.name`,
  )
    .all(uuidToBytes(bookmarkId))
    .map(mapBookmarkTag);
}

/** Batch tag lookup used to hydrate bookmark lists without an N+1 query. */
export function getTagsForBookmarks(
  db: Database,
  bookmarkIds: string[],
): Map<string, BookmarkTagView[]> {
  const result = new Map<string, BookmarkTagView[]>();
  if (bookmarkIds.length === 0) {
    return result;
  }

  for (const id of bookmarkIds) {
    result.set(id, []);
  }

  const placeholders = bookmarkIds.map(() => '?').join(', ');
  // Dynamic arity (varies with caller) — intentionally not cached.
  const rows = db
    .query<BookmarkTagRow & { bookmark_id: Uint8Array }, Uint8Array[]>(
      `SELECT bt.bookmark_id, bt.tag_id, t.name, bt.source, bt.confidence
         FROM bookmark_tags bt
         JOIN tags t ON t.id = bt.tag_id
        WHERE bt.bookmark_id IN (${placeholders})
        ORDER BY t.name`,
    )
    .all(...bookmarkIds.map(uuidToBytes));

  for (const row of rows) {
    const key = bytesToUuid(row.bookmark_id);
    const list = result.get(key);
    if (list) {
      list.push(mapBookmarkTag(row));
    }
  }

  return result;
}
