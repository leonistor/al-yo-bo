import type { Database } from 'bun:sqlite';

import { bytesToUuid, uuidToBytes } from '@al-yo-bo/shared';

import { prepared } from './statements.ts';

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
  return prepared<EmbeddingRow, []>(
    db,
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

export function getEmbedding(db: Database, bookmarkId: string): EmbeddingRecord | null {
  const row = prepared<EmbeddingRow, [Uint8Array]>(
    db,
    'SELECT bookmark_id, model, dims, embedding FROM bookmark_embeddings WHERE bookmark_id = ?',
  ).get(uuidToBytes(bookmarkId));
  return row
    ? {
        bookmarkId: bytesToUuid(row.bookmark_id),
        model: row.model,
        dims: row.dims,
        embedding: row.embedding,
      }
    : null;
}

/** Bookmarks with scraped content but no embedding yet (startup reconciliation). */
export function listBookmarkIdsMissingEmbeddings(db: Database): string[] {
  return prepared<{ id: Uint8Array }, []>(
    db,
    `SELECT b.id FROM bookmarks b
        WHERE b.content IS NOT NULL
          AND b.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM bookmark_embeddings e WHERE e.bookmark_id = b.id)`,
  )
    .all()
    .map((row) => bytesToUuid(row.id));
}

/**
 * Rows embedded by a different model than the configured one (ARCHITECTURE §6:
 * all rows share one dimension; a model change requires a re-embed pass, which
 * reconciliation drives).
 */
export function listEmbeddingModelMismatches(db: Database, model: string): string[] {
  return prepared<{ bookmark_id: Uint8Array }, [string]>(
    db,
    `SELECT e.bookmark_id FROM bookmark_embeddings e
         JOIN bookmarks b ON b.id = e.bookmark_id
        WHERE e.model != ? AND b.status = 'active'`,
  )
    .all(model)
    .map((row) => bytesToUuid(row.bookmark_id));
}

export function upsertEmbedding(db: Database, input: EmbeddingInput): void {
  prepared(
    db,
    `INSERT INTO bookmark_embeddings (bookmark_id, model, dims, embedding)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (bookmark_id) DO UPDATE SET
       model = excluded.model,
       dims = excluded.dims,
       embedding = excluded.embedding,
        -- Re-embeds are real updates: bump freshness so consumers can tell the
        -- canonical SQLite copy apart from a stale one. The insert path is
        -- covered by the bookmark_embeddings_force_created trigger (0001);
        -- the conflict path is an UPDATE, which no trigger covers.
       updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)`,
  ).run(uuidToBytes(input.bookmarkId), input.model, input.dims, input.embedding);
}

export function deleteEmbedding(db: Database, bookmarkId: string): boolean {
  const result = prepared(db, 'DELETE FROM bookmark_embeddings WHERE bookmark_id = ?').run(
    uuidToBytes(bookmarkId),
  );
  return result.changes > 0;
}
