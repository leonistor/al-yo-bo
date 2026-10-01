import type { Database } from 'bun:sqlite';

import { bytesToUuid, newIdBytes, uuidToBytes, type Section } from '@al-yo-bo/shared';

import { mapSection, type SectionRow } from '../row-mapping.ts';

const COLUMNS = 'id, dataset_id, name, description, created_at';

export function listSections(db: Database, datasetId: string): Section[] {
  return db
    .query<SectionRow, [Uint8Array]>(
      `SELECT ${COLUMNS} FROM sections WHERE dataset_id = ? ORDER BY name`,
    )
    .all(uuidToBytes(datasetId))
    .map(mapSection);
}

export function getSectionById(db: Database, id: string): Section | null {
  const row = db
    .query<SectionRow, [Uint8Array]>(`SELECT ${COLUMNS} FROM sections WHERE id = ?`)
    .get(uuidToBytes(id));
  return row ? mapSection(row) : null;
}

export function getSectionByName(db: Database, datasetId: string, name: string): Section | null {
  const row = db
    .query<SectionRow, [Uint8Array, string]>(
      `SELECT ${COLUMNS} FROM sections WHERE dataset_id = ? AND name = ?`,
    )
    .get(uuidToBytes(datasetId), name);
  return row ? mapSection(row) : null;
}

export interface SectionInput {
  datasetId: string;
  name: string;
  description?: string | null;
}

/** Returns the existing section when the name is taken (unique per dataset). */
export function createSection(db: Database, input: SectionInput): Section {
  const existing = getSectionByName(db, input.datasetId, input.name);
  if (existing) {
    return existing;
  }
  const id = newIdBytes();
  db.query(
    'INSERT INTO sections (id, dataset_id, name, description) VALUES (?, ?, ?, ?)',
  ).run(
    id,
    uuidToBytes(input.datasetId),
    input.name,
    input.description ?? null,
  );
  const created = getSectionById(db, bytesToUuid(id));
  if (!created) {
    throw new Error('Section insert did not persist');
  }
  return created;
}

export function updateSection(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null },
): Section | null {
  const current = getSectionById(db, id);
  if (!current) {
    return null;
  }
  db.query('UPDATE sections SET name = ?, description = ? WHERE id = ?').run(
    patch.name ?? current.name,
    patch.description === undefined ? current.description : patch.description,
    uuidToBytes(id),
  );
  return getSectionById(db, id);
}

export function deleteSection(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM sections WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
