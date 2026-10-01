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

export interface DatasetContentCounts {
  bookmarks: number;
  tags: number;
  categories: number;
  sections: number;
}

/** Counts the rows a `clearDatasetContent` call would remove for one dataset. */
export function countDatasetContent(db: Database, datasetId: string): DatasetContentCounts {
  const id = uuidToBytes(datasetId);
  const count = (sql: string): number =>
    db.query<{ n: number }, [Uint8Array]>(sql).get(id)?.n ?? 0;
  return {
    bookmarks: count('SELECT COUNT(*) AS n FROM bookmarks WHERE dataset_id = ?'),
    tags: count('SELECT COUNT(*) AS n FROM tags WHERE dataset_id = ?'),
    categories: count('SELECT COUNT(*) AS n FROM categories WHERE dataset_id = ?'),
    sections: count('SELECT COUNT(*) AS n FROM sections WHERE dataset_id = ?'),
  };
}

/**
 * Removes every bookmark and all vocabulary (sections, categories, tags) for
 * one dataset while keeping the dataset row itself so the name can be reused.
 * Strictly scoped by `dataset_id`; other datasets are untouched.
 *
 * Deletes run parent-first and lean on the schema's cascade rules (MODEL.md
 * "Deletion semantics"): removing bookmarks cascades classification evidence,
 * assignments and embeddings, and the `bookmarks_fts_delete` triggers drop the
 * keyword rows; removing tags then cascades the remaining assignment/result
 * rows. The whole sweep is one immediate transaction. Counts are taken before
 * the deletes because `run().changes` is not reliable once triggers fire.
 *
 * Note: the `import_batches` table was removed in Phase 1 (direct-commit
 * imports — see docs/plans/2026-10-01-import-simplification-*.md), so no
 * staged-batch cleanup is needed here.
 */
export function clearDatasetContent(db: Database, datasetId: string): DatasetContentCounts {
  const id = uuidToBytes(datasetId);
  const counts = countDatasetContent(db, datasetId);
  const run = db.transaction(() => {
    db.query('DELETE FROM bookmarks WHERE dataset_id = ?').run(id);
    db.query('DELETE FROM tags WHERE dataset_id = ?').run(id);
    db.query('DELETE FROM categories WHERE dataset_id = ?').run(id);
    db.query('DELETE FROM sections WHERE dataset_id = ?').run(id);
  });
  run.immediate();
  return counts;
}
