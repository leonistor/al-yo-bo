import type { Database } from 'bun:sqlite';

import { bytesToUuid, newIdBytes, uuidToBytes, type Tag, type TagStatus } from '@al-yo-bo/shared';

import { mapTag, type TagRow } from '../row-mapping.ts';

const COLUMNS = 'id, category_id, name, description, status, created_at';

export function listTags(db: Database): Tag[] {
  return db
    .query<TagRow, []>(`SELECT ${COLUMNS} FROM tags ORDER BY name`)
    .all()
    .map(mapTag);
}

export function listTagsByStatus(db: Database, status: TagStatus): Tag[] {
  return db
    .query<TagRow, [string]>(`SELECT ${COLUMNS} FROM tags WHERE status = ? ORDER BY name`)
    .all(status)
    .map(mapTag);
}

export function getTagById(db: Database, id: string): Tag | null {
  const row = db
    .query<TagRow, [Uint8Array]>(`SELECT ${COLUMNS} FROM tags WHERE id = ?`)
    .get(uuidToBytes(id));
  return row ? mapTag(row) : null;
}

/** Name is unique within a scope: per category when scoped, globally when unscoped. */
export function getTagByName(db: Database, name: string, categoryId: string | null): Tag | null {
  const row = categoryId
    ? db
        .query<TagRow, [string, Uint8Array]>(
          `SELECT ${COLUMNS} FROM tags WHERE name = ? AND category_id = ?`,
        )
        .get(name, uuidToBytes(categoryId))
    : db
        .query<TagRow, [string]>(`SELECT ${COLUMNS} FROM tags WHERE name = ? AND category_id IS NULL`)
        .get(name);
  return row ? mapTag(row) : null;
}

export interface TagInput {
  name: string;
  categoryId?: string | null;
  description?: string | null;
  status?: TagStatus;
}

export function createTag(db: Database, input: TagInput): Tag {
  const categoryId = input.categoryId ?? null;
  const existing = getTagByName(db, input.name, categoryId);
  if (existing) {
    return existing;
  }
  const id = newIdBytes();
  db.query(
    'INSERT INTO tags (id, category_id, name, description, status) VALUES (?, ?, ?, ?, ?)',
  ).run(
    id,
    categoryId ? uuidToBytes(categoryId) : null,
    input.name,
    input.description ?? null,
    input.status ?? 'active',
  );
  const created = getTagById(db, bytesToUuid(id));
  if (!created) {
    throw new Error('Tag insert did not persist');
  }
  return created;
}

export function setTagStatus(db: Database, id: string, status: TagStatus): Tag | null {
  const result = db
    .query('UPDATE tags SET status = ? WHERE id = ?')
    .run(status, uuidToBytes(id));
  if (result.changes === 0) {
    return null;
  }
  return getTagById(db, id);
}

export function updateTag(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null; categoryId?: string | null },
): Tag | null {
  const current = getTagById(db, id);
  if (!current) {
    return null;
  }
  const categoryId = patch.categoryId === undefined ? current.categoryId : patch.categoryId;
  db.query('UPDATE tags SET name = ?, description = ?, category_id = ? WHERE id = ?').run(
    patch.name ?? current.name,
    patch.description === undefined ? current.description : patch.description,
    categoryId ? uuidToBytes(categoryId) : null,
    uuidToBytes(id),
  );
  return getTagById(db, id);
}

export function deleteTag(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM tags WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
