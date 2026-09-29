import type { Database } from 'bun:sqlite';

import { bytesToUuid, uuidToBytes } from '@al-yo-bo/shared';

export interface EmbeddingRecord {
  bookmarkId: string;
  model: string;
  dims: number;
  embedding: Uint8Array;
}

export interface EmbeddingInput {
  bookmarkId: string;
  model: string;
  dims: number;
  embedding: Uint8Array;
}

interface EmbeddingRow {
  bookmark_id: Uint8Array;
  model: string;
  dims: number;
  embedding: Uint8Array;
}

export function listEmbeddings(db: Database): EmbeddingRecord[] {
  return db
    .query<EmbeddingRow, []>(
      'SELECT bookmark_id, model, dims, embedding FROM bookmark_embeddings',
    )
    .all()
    .map((row) => ({
      bookmarkId: bytesToUuid(row.bookmark_id),
      model: row.model,
      dims: row.dims,
      embedding: row.embedding,
    }));
}

export function upsertEmbedding(db: Database, input: EmbeddingInput): void {
  db.query(
    `INSERT INTO bookmark_embeddings (bookmark_id, model, dims, embedding)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (bookmark_id) DO UPDATE SET
       model = excluded.model,
       dims = excluded.dims,
       embedding = excluded.embedding`,
  ).run(uuidToBytes(input.bookmarkId), input.model, input.dims, input.embedding);
}

export function deleteEmbedding(db: Database, bookmarkId: string): boolean {
  const result = db
    .query('DELETE FROM bookmark_embeddings WHERE bookmark_id = ?')
    .run(uuidToBytes(bookmarkId));
  return result.changes > 0;
}
