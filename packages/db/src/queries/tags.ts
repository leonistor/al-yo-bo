import type { Database } from 'bun:sqlite';

import { bytesToUuid, uuidToBytes, type Tag, type TagStatus } from '@al-yo-bo/shared';

import { mapTag, type TagRow } from '../row-mapping.ts';
import { newIdBytes } from '../uuid.ts';
import { requireVocabularyName } from '../vocab-validation.ts';
import { prepared } from './statements.ts';

/**
 * Controlled vocabulary — one flat, global namespace (MODEL.md principle 2:
 * tags have no category; the classifier candidate set is all `active` tags).
 * Names are globally unique via `tags_name_unique`; lifecycle is the two-state
 * `active ⇄ deprecated`, where only `active` tags are auto-assignable.
 */

const COLUMNS = 'id, name, description, status, created_at';

export function listTags(db: Database): Tag[] {
  return prepared<TagRow, []>(db, `SELECT ${COLUMNS} FROM tags ORDER BY name`).all().map(mapTag);
}

export function countTags(db: Database): number {
  return (
    prepared<{ count: number }, []>(db, 'SELECT COUNT(*) AS count FROM tags').get()?.count ?? 0
  );
}

export function listTagsByStatus(db: Database, status: TagStatus): Tag[] {
  return prepared<TagRow, [string]>(
    db,
    `SELECT ${COLUMNS} FROM tags WHERE status = ? ORDER BY name`,
  )
    .all(status)
    .map(mapTag);
}

/** The classifier candidate set: ALL active tags (ARCHITECTURE §7 stage 0). */
export function listActiveTags(db: Database): Tag[] {
  return listTagsByStatus(db, 'active');
}

export function getTagById(db: Database, id: string): Tag | null {
  const row = prepared<TagRow, [Uint8Array]>(db, `SELECT ${COLUMNS} FROM tags WHERE id = ?`).get(
    uuidToBytes(id),
  );
  return row ? mapTag(row) : null;
}

export function getTagByName(db: Database, name: string): Tag | null {
  const row = prepared<TagRow, [string]>(db, `SELECT ${COLUMNS} FROM tags WHERE name = ?`).get(
    name,
  );
  return row ? mapTag(row) : null;
}

export interface TagInput {
  name: string;
  description?: string | null;
}

/**
 * Creates a tag `active` (vocabulary is created in its usable state, MODEL.md
 * principle 3). Returns the existing tag when the name is taken — the
 * merge-by-name behavior the importer relies on.
 */
export function createTag(db: Database, input: TagInput): Tag {
  const name = requireVocabularyName('tag', input.name);
  const run = db.transaction(() => {
    const existing = getTagByName(db, name);
    if (existing) {
      return existing;
    }
    const id = newIdBytes();
    prepared(db, 'INSERT INTO tags (id, name, description, status) VALUES (?, ?, ?, ?)').run(
      id,
      name,
      input.description ?? null,
      'active',
    );
    const created = getTagById(db, bytesToUuid(id));
    if (!created) {
      throw new Error('Tag insert did not persist');
    }
    return created;
  });
  return run.immediate();
}

/** `active ⇄ deprecated`: deprecating retires a tag from classification without deleting history. */
export function setTagStatus(db: Database, id: string, status: TagStatus): Tag | null {
  const result = prepared(db, 'UPDATE tags SET status = ? WHERE id = ?').run(
    status,
    uuidToBytes(id),
  );
  if (result.changes === 0) {
    return null;
  }
  return getTagById(db, id);
}

export function updateTag(
  db: Database,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
  },
): Tag | null {
  const current = getTagById(db, id);
  if (!current) {
    return null;
  }
  prepared(db, 'UPDATE tags SET name = ?, description = ? WHERE id = ?').run(
    patch.name ?? current.name,
    patch.description === undefined ? current.description : patch.description,
    uuidToBytes(id),
  );
  return getTagById(db, id);
}

export function deleteTag(db: Database, id: string): boolean {
  const result = prepared(db, 'DELETE FROM tags WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
