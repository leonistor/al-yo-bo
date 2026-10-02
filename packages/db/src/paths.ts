import { join, resolve } from 'node:path';

/** Repo root — this file lives at `packages/db/src/`. */
const REPO_ROOT = resolve(import.meta.dir, '../../..');

/**
 * Resolves the data root (ARCHITECTURE §5): the single directory holding every
 * file artifact — the SQLite database, screenshots, the profile avatar, and
 * the Qdrant storage tree. One env knob (`DATA_DIR`) relocates the whole tree
 * for deployment or backup. Relative values are anchored to the repo root —
 * not the cwd — because `bun run` scripts start with different working
 * directories; absolute values pass through unchanged.
 */
export function resolveDataDir(dataDir: string = process.env.DATA_DIR ?? 'data'): string {
  return resolve(REPO_ROOT, dataDir);
}

/**
 * Default SQLite location inside the data root. `DB_PATH` overrides it when
 * set. The CLI entry points (`db:seed`, `db:clear`) and the server must agree
 * on the same file, so they share this derivation instead of each inventing
 * a path.
 */
export function defaultDbPath(dataDir: string = process.env.DATA_DIR ?? 'data'): string {
  return join(resolveDataDir(dataDir), 'bookmarks.db');
}
