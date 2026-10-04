import type { Database } from 'bun:sqlite';

import {
  bytesToUuid,
  uuidToBytes,
  type AssignmentSource,
  type BookmarkTagView,
} from '@al-yo-bo/shared';

import { mapBookmarkTag, type BookmarkTagRow } from '../row-mapping.ts';
import { newIdBytes } from '../uuid.ts';
import { prepared } from './statements.ts';

export interface AssignTagInput {
  bookmarkId: string;
  tagId: string;
  source: AssignmentSource;
  confidence?: number | null;
  runId?: string | null;
}

/**
 * Upserts an effective assignment. User and import rows win (ARCHITECTURE §7
 * "User rows win"): classifier-sourced assignments never overwrite them, and
 * classifier re-runs never retract them (reconcileClassifierAssignments only
 * deletes `source = 'classifier'` rows).
 */
export function assignTag(db: Database, input: AssignTagInput): void {
  const existing = prepared<{ source: string }, [Uint8Array, Uint8Array]>(
    db,
    'SELECT source FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?',
  ).get(uuidToBytes(input.bookmarkId), uuidToBytes(input.tagId));

  if (
    existing &&
    input.source === 'classifier' &&
    (existing.source === 'user' || existing.source === 'import')
  ) {
    return;
  }
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

/**
 * Bookmark ids carrying an effective assignment to this tag. Captured before a
 * tag delete so callers can resync the denormalized vector payloads; the
 * `bookmark_tags` rows themselves are removed by the FK cascade.
 */
export function listBookmarkIdsForTag(db: Database, tagId: string): string[] {
  return prepared<{ bookmark_id: Uint8Array }, [Uint8Array]>(
    db,
    'SELECT bookmark_id FROM bookmark_tags WHERE tag_id = ?',
  )
    .all(uuidToBytes(tagId))
    .map((row) => bytesToUuid(row.bookmark_id));
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
