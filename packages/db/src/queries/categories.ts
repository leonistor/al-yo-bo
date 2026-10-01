import type { Database } from 'bun:sqlite';

import { bytesToUuid, newIdBytes, uuidToBytes, type Category } from '@al-yo-bo/shared';

import { mapCategory, type CategoryRow } from '../row-mapping.ts';

const COLUMNS = 'id, dataset_id, section_id, name, description, created_at';

export function listCategories(db: Database, datasetId: string): Category[] {
  return db
    .query<CategoryRow, [Uint8Array]>(
      `SELECT ${COLUMNS} FROM categories WHERE dataset_id = ? ORDER BY name`,
    )
    .all(uuidToBytes(datasetId))
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
}

/** Returns the existing category when the name is taken (unique per dataset). */
export function createCategory(db: Database, input: CategoryInput): Category {
  const existing = getCategoryByName(db, input.datasetId, input.name);
  if (existing) {
    return existing;
  }
  const id = newIdBytes();
  db.query(
    `INSERT INTO categories (id, dataset_id, section_id, name, description)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    uuidToBytes(input.datasetId),
    input.sectionId ? uuidToBytes(input.sectionId) : null,
    input.name,
    input.description ?? null,
  );
  const created = getCategoryById(db, bytesToUuid(id));
  if (!created) {
    throw new Error('Category insert did not persist');
  }
  return created;
}

export function updateCategory(
  db: Database,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    sectionId?: string | null;
  },
): Category | null {
  const current = getCategoryById(db, id);
  if (!current) {
    return null;
  }
  const sectionId = patch.sectionId === undefined ? current.sectionId : patch.sectionId;
  db.query(
    'UPDATE categories SET name = ?, description = ?, section_id = ? WHERE id = ?',
  ).run(
    patch.name ?? current.name,
    patch.description === undefined ? current.description : patch.description,
    sectionId ? uuidToBytes(sectionId) : null,
    uuidToBytes(id),
  );
  return getCategoryById(db, id);
}

export function deleteCategory(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM categories WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
