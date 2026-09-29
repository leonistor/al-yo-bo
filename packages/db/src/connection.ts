import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Opens the single SQLite file and applies the connection-level PRAGMAs required
 * by MODEL.md. WAL persistence differs per platform; on macOS Apple's system
 * SQLite keeps `-wal`/`-shm` files after close, so a truncating checkpoint is
 * offered via `checkpoint(db)` for callers that need a single-file snapshot.
 */
export function openDatabase(path = process.env.DB_PATH ?? './data/bookmarks.db'): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

/** Flushes the WAL into the main database file so a file copy is a complete backup. */
export function checkpoint(db: Database): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
}
