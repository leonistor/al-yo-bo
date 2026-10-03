import { join, resolve } from 'node:path';

/** Repo root — this file lives at `packages/db/src/`. */
const REPO_ROOT = resolve(import.meta.dir, '../../..');

/** Path-segment-safe profile name (must match the check in scripts/dev.sh). */
const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Per-profile data root (dev only, set by `scripts/dev.sh`); undefined when absent or invalid. */
function devProfileDir(): string | undefined {
  const profile = process.env.PROFILE;
  return profile && PROFILE_NAME_RE.test(profile) ? `data/profiles/${profile}` : undefined;
}

/**
 * Resolves the data root (ARCHITECTURE §5): the single directory holding every
 * file artifact — the SQLite database, screenshots, the profile avatar, and
 * the Qdrant storage tree. One env knob (`DATA_DIR`) relocates the whole tree
 * for deployment or backup. Relative values are anchored to the repo root —
 * not the cwd — because `bun run` scripts start with different working
 * directories; absolute values pass through unchanged.
 *
 * `PROFILE` (set by `bun run dev -- --profile=<name>`) isolates the tree under
 * `data/profiles/<name>` when `DATA_DIR` is unset — dev sugar so CLI entry
 * points (`db:seed`, `db:clear`) target the same profile as the dev server.
 * Precedence: explicit arg > `DATA_DIR` > `PROFILE` > `data/`.
 */
export function resolveDataDir(
  dataDir: string = process.env.DATA_DIR ?? devProfileDir() ?? 'data',
): string {
  return resolve(REPO_ROOT, dataDir);
}

/**
 * Default SQLite location inside the data root. `DB_PATH` overrides it when
 * set. The CLI entry points (`db:seed`, `db:clear`) and the server must agree
 * on the same file, so they share this derivation instead of each inventing
 * a path. Delegates to `resolveDataDir` for the full precedence chain
 * (arg > `DATA_DIR` > `PROFILE` > `data/`).
 */
export function defaultDbPath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), 'bookmarks.db');
}
