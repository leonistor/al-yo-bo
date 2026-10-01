import type { Database } from 'bun:sqlite';

import { bytesToUuid, newIdBytes, uuidToBytes, type Tag, type TagStatus } from '@al-yo-bo/shared';

import { mapTag, type TagRow } from '../row-mapping.ts';

const COLUMNS = 'id, dataset_id, category_id, name, description, status, created_at';

export function listTags(db: Database, datasetId: string): Tag[] {
  return db
    .query<TagRow, [Uint8Array]>(`SELECT ${COLUMNS} FROM tags WHERE dataset_id = ? ORDER BY name`)
    .all(uuidToBytes(datasetId))
    .map(mapTag);
}

export function listTagsByStatus(db: Database, datasetId: string, status: TagStatus): Tag[] {
  return db
    .query<TagRow, [Uint8Array, string]>(
      `SELECT ${COLUMNS} FROM tags WHERE dataset_id = ? AND status = ? ORDER BY name`,
    )
    .all(uuidToBytes(datasetId), status)
    .map(mapTag);
}

export function getTagById(db: Database, id: string): Tag | null {
  const row = db
    .query<TagRow, [Uint8Array]>(`SELECT ${COLUMNS} FROM tags WHERE id = ?`)
    .get(uuidToBytes(id));
  return row ? mapTag(row) : null;
}

/** Name is unique within a scope: per (dataset, category) when scoped, per dataset when unscoped. */
export function getTagByName(
  db: Database,
  datasetId: string,
  name: string,
  categoryId: string | null,
): Tag | null {
  const row = categoryId
    ? db
        .query<TagRow, [Uint8Array, string, Uint8Array]>(
          `SELECT ${COLUMNS} FROM tags WHERE dataset_id = ? AND name = ? AND category_id = ?`,
        )
        .get(uuidToBytes(datasetId), name, uuidToBytes(categoryId))
    : db
        .query<TagRow, [Uint8Array, string]>(
          `SELECT ${COLUMNS} FROM tags WHERE dataset_id = ? AND name = ? AND category_id IS NULL`,
        )
        .get(uuidToBytes(datasetId), name);
  return row ? mapTag(row) : null;
}

export interface TagInput {
  datasetId: string;
  name: string;
  categoryId?: string | null;
  description?: string | null;
}

export function createTag(db: Database, input: TagInput): Tag {
  const categoryId = input.categoryId ?? null;
  const existing = getTagByName(db, input.datasetId, input.name, categoryId);
  if (existing) {
    return existing;
  }
  const id = newIdBytes();
  db.query(
    `INSERT INTO tags (id, dataset_id, category_id, name, description, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    uuidToBytes(input.datasetId),
    categoryId ? uuidToBytes(categoryId) : null,
    input.name,
    input.description ?? null,
    'active',
  );
  const created = getTagById(db, bytesToUuid(id));
  if (!created) {
    throw new Error('Tag insert did not persist');
  }
  return created;
}

export function setTagStatus(db: Database, id: string, status: TagStatus): Tag | null {
  const result = db.query('UPDATE tags SET status = ? WHERE id = ?').run(status, uuidToBytes(id));
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
    categoryId?: string | null;
  },
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
