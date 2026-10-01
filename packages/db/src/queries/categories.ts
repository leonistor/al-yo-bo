import type { Database } from 'bun:sqlite';

import {
  bytesToUuid,
  newIdBytes,
  uuidToBytes,
  type Category,
  type CategoryStatus,
} from '@al-yo-bo/shared';

import { mapCategory, type CategoryRow } from '../row-mapping.ts';

const COLUMNS = 'id, dataset_id, section_id, name, description, status, merged_into_id, created_at';

export function listCategories(db: Database, datasetId: string): Category[] {
  return db
    .query<CategoryRow, [Uint8Array]>(
      `SELECT ${COLUMNS} FROM categories WHERE dataset_id = ? ORDER BY name`,
    )
    .all(uuidToBytes(datasetId))
    .map(mapCategory);
}

export function listCategoriesByStatus(
  db: Database,
  datasetId: string,
  status: CategoryStatus,
): Category[] {
  return db
    .query<CategoryRow, [Uint8Array, string]>(
      `SELECT ${COLUMNS} FROM categories WHERE dataset_id = ? AND status = ? ORDER BY name`,
    )
    .all(uuidToBytes(datasetId), status)
    .map(mapCategory);
}

export function getCategoryById(db: Database, id: string): Category | null {
  const row = db
    .query<CategoryRow, [Uint8Array]>(`SELECT ${COLUMNS} FROM categories WHERE id = ?`)
    .get(uuidToBytes(id));
  return row ? mapCategory(row) : null;
}

export function getCategoryByName(db: Database, datasetId: string, name: string): Category | null {
  const row = db
    .query<CategoryRow, [Uint8Array, string]>(
      `SELECT ${COLUMNS} FROM categories WHERE dataset_id = ? AND name = ?`,
    )
    .get(uuidToBytes(datasetId), name);
  return row ? mapCategory(row) : null;
}

export interface CategoryInput {
  datasetId: string;
  name: string;
  description?: string | null;
  sectionId?: string | null;
  status?: CategoryStatus;
}

/** Returns the existing category when the name is taken (unique per dataset). */
export function createCategory(db: Database, input: CategoryInput): Category {
  const existing = getCategoryByName(db, input.datasetId, input.name);
  if (existing) {
    return existing;
  }
  const id = newIdBytes();
  db.query(
    `INSERT INTO categories (id, dataset_id, section_id, name, description, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    uuidToBytes(input.datasetId),
    input.sectionId ? uuidToBytes(input.sectionId) : null,
    input.name,
    input.description ?? null,
    input.status ?? 'active',
  );
  const created = getCategoryById(db, bytesToUuid(id));
  if (!created) {
    throw new Error('Category insert did not persist');
  }
  return created;
}

export function setCategoryStatus(
  db: Database,
  id: string,
  status: CategoryStatus,
): Category | null {
  const result = db
    .query('UPDATE categories SET status = ? WHERE id = ?')
    .run(status, uuidToBytes(id));
  if (result.changes === 0) {
    return null;
  }
  return getCategoryById(db, id);
}

export function updateCategory(
  db: Database,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    sectionId?: string | null;
    mergedIntoId?: string | null;
  },
): Category | null {
  const current = getCategoryById(db, id);
  if (!current) {
    return null;
  }
  const sectionId = patch.sectionId === undefined ? current.sectionId : patch.sectionId;
  const mergedIntoId = patch.mergedIntoId === undefined ? current.mergedIntoId : patch.mergedIntoId;
  db.query(
    'UPDATE categories SET name = ?, description = ?, section_id = ?, merged_into_id = ? WHERE id = ?',
  ).run(
    patch.name ?? current.name,
    patch.description === undefined ? current.description : patch.description,
    sectionId ? uuidToBytes(sectionId) : null,
    mergedIntoId ? uuidToBytes(mergedIntoId) : null,
    uuidToBytes(id),
  );
  return getCategoryById(db, id);
}

export function deleteCategory(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM categories WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
