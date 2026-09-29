import type { Database } from 'bun:sqlite';

import { bytesToUuid, newIdBytes, uuidToBytes, type Category } from '@al-yo-bo/shared';

import { mapCategory, type CategoryRow } from '../row-mapping.ts';

const COLUMNS = 'id, name, description, created_at';

export function listCategories(db: Database): Category[] {
  return db
    .query<CategoryRow, []>(`SELECT ${COLUMNS} FROM categories ORDER BY name`)
    .all()
    .map(mapCategory);
}

export function getCategoryById(db: Database, id: string): Category | null {
  const row = db
    .query<CategoryRow, [Uint8Array]>(`SELECT ${COLUMNS} FROM categories WHERE id = ?`)
    .get(uuidToBytes(id));
  return row ? mapCategory(row) : null;
}

export function getCategoryByName(db: Database, name: string): Category | null {
  const row = db
    .query<CategoryRow, [string]>(`SELECT ${COLUMNS} FROM categories WHERE name = ?`)
    .get(name);
  return row ? mapCategory(row) : null;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
}

/** Returns the existing category when the name is taken (name is unique). */
export function createCategory(db: Database, input: CategoryInput): Category {
  const existing = getCategoryByName(db, input.name);
  if (existing) {
    return existing;
  }
  const id = newIdBytes();
  db.query('INSERT INTO categories (id, name, description) VALUES (?, ?, ?)').run(
    id,
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
  patch: { name?: string; description?: string | null },
): Category | null {
  const current = getCategoryById(db, id);
  if (!current) {
    return null;
  }
  db.query('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(
    patch.name ?? current.name,
    patch.description === undefined ? current.description : patch.description,
    uuidToBytes(id),
  );
  return getCategoryById(db, id);
}

export function deleteCategory(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM categories WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
