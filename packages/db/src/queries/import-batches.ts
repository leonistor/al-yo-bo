import type { Database } from 'bun:sqlite';

import {
  bytesToUuid,
  newIdBytes,
  uuidToBytes,
  type ImportBatchStatus,
  type ImportedBookmark,
} from '@al-yo-bo/shared';

export interface ImportBatchRow {
  id: Uint8Array;
  dataset_id: Uint8Array;
  file: string | null;
  bookmarks: string;
  status: string;
  created_at: number;
  committed_at: number | null;
}

export interface ImportBatch {
  id: string;
  datasetId: string;
  file: string | null;
  bookmarks: ImportedBookmark[];
  status: ImportBatchStatus;
  createdAt: number;
  committedAt: number | null;
}

function mapBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: bytesToUuid(row.id),
    datasetId: bytesToUuid(row.dataset_id),
    file: row.file,
    bookmarks: JSON.parse(row.bookmarks) as ImportedBookmark[],
    status: row.status as ImportBatchStatus,
    createdAt: row.created_at,
    committedAt: row.committed_at,
  };
}

export function getImportBatchById(db: Database, id: string): ImportBatch | null {
  const row = db
    .query<ImportBatchRow, [Uint8Array]>(
      `SELECT id, dataset_id, file, bookmarks, status, created_at, committed_at
         FROM import_batches WHERE id = ?`,
    )
    .get(uuidToBytes(id));
  return row ? mapBatch(row) : null;
}

export function listStagedBatches(db: Database, datasetId: string): ImportBatch[] {
  return db
    .query<ImportBatchRow, [Uint8Array]>(
      `SELECT id, dataset_id, file, bookmarks, status, created_at, committed_at
         FROM import_batches
        WHERE dataset_id = ? AND status = 'staged'
        ORDER BY created_at`,
    )
    .all(uuidToBytes(datasetId))
    .map(mapBatch);
}

export function createImportBatch(
  db: Database,
  input: { datasetId: string; file?: string | null; bookmarks: ImportedBookmark[] },
): ImportBatch {
  const id = newIdBytes();
  db.query(
    'INSERT INTO import_batches (id, dataset_id, file, bookmarks, status) VALUES (?, ?, ?, ?, ?)',
  ).run(
    id,
    uuidToBytes(input.datasetId),
    input.file ?? null,
    JSON.stringify(input.bookmarks),
    'staged',
  );
  const created = getImportBatchById(db, bytesToUuid(id));
  if (!created) {
    throw new Error('Import batch insert did not persist');
  }
  return created;
}

export function setImportBatchStatus(
  db: Database,
  id: string,
  status: ImportBatchStatus,
): ImportBatch | null {
  const committedAt = status === 'committed' ? Date.now() : null;
  const result = db
    .query('UPDATE import_batches SET status = ?, committed_at = ? WHERE id = ?')
    .run(status, committedAt, uuidToBytes(id));
  if (result.changes === 0) {
    return null;
  }
  return getImportBatchById(db, id);
}

export function deleteImportBatch(db: Database, id: string): boolean {
  const result = db.query('DELETE FROM import_batches WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}
