import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { checkpoint } from './connection.ts';

const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

interface MigrationRow {
  version: string;
}

/**
 * Forward-only migration runner. Each pending file is applied inside its own
 * transaction and recorded in `schema_migrations`.
 */
export function migrate(db: Database, migrationsDir = MIGRATIONS_DIR): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);

  const applied = new Set(
    db
      .query<MigrationRow, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  );

  const pending = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .toSorted()
    .filter((file) => !applied.has(file));

  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const insideTransaction = db.transaction(() => {
      db.exec(sql);
      db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        file,
        Date.now(),
      );
    });
    insideTransaction.immediate();
  }

  return pending;
}

/** Convenience for startup: open + migrate + checkpoint in one call. */
export function setupDatabase(db: Database, migrationsDir?: string): string[] {
  const applied = migrate(db, migrationsDir);
  checkpoint(db);
  return applied;
}
