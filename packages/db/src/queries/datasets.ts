import type { Database } from 'bun:sqlite';

import { bytesToUuid, newIdBytes, uuidToBytes, type Dataset } from '@al-yo-bo/shared';

import { mapDataset, type DatasetRow } from '../row-mapping.ts';

const COLUMNS = 'id, name, created_at';

export function listDatasets(db: Database): Dataset[] {
  return db
    .query<DatasetRow, []>(`SELECT ${COLUMNS} FROM datasets ORDER BY name`)
    .all()
    .map(mapDataset);
}

export function getDatasetById(db: Database, id: string): Dataset | null {
  const row = db
    .query<DatasetRow, [Uint8Array]>(`SELECT ${COLUMNS} FROM datasets WHERE id = ?`)
    .get(uuidToBytes(id));
  return row ? mapDataset(row) : null;
}

export function getDatasetByName(db: Database, name: string): Dataset | null {
  const row = db
    .query<DatasetRow, [string]>(`SELECT ${COLUMNS} FROM datasets WHERE name = ?`)
    .get(name);
  return row ? mapDataset(row) : null;
}

/** Returns the existing dataset when the name is taken (name is unique). */
export function createDataset(db: Database, name: string): Dataset {
  const existing = getDatasetByName(db, name);
  if (existing) {
    return existing;
  }
  const id = newIdBytes();
  db.query('INSERT INTO datasets (id, name) VALUES (?, ?)').run(id, name);
  const created = getDatasetById(db, bytesToUuid(id));
  if (!created) {
    throw new Error('Dataset insert did not persist');
  }
  return created;
}

export function deleteDataset(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM datasets WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
