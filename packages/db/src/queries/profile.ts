import type { Database } from 'bun:sqlite';
import type { SQLQueryBindings } from 'bun:sqlite';

import { uuidToBytes, type Profile } from '@al-yo-bo/shared';

import { mapProfile, type ProfileRow } from '../row-mapping.ts';
import { prepared } from './statements.ts';

/**
 * Fixed sentinel id of the singleton profile row (all-zero BLOB). Migration
 * 0007 inserts it; the app reads the profile by id, never by name.
 */
export const PROFILE_ID = '00000000-0000-0000-0000-000000000000';

const COLUMNS =
  'id, name, github_username, avatar_path, active_dataset_id, created_at, updated_at';

export function getProfile(db: Database): Profile | null {
  const row = prepared<ProfileRow, [Uint8Array]>(
    db,
    `SELECT ${COLUMNS} FROM profile WHERE id = ?`,
  ).get(uuidToBytes(PROFILE_ID));
  return row ? mapProfile(row) : null;
}

export interface ProfilePatch {
  name?: string | null;
  githubUsername?: string | null;
  avatarPath?: string | null;
  activeDatasetId?: string | null;
}

/**
 * Partial update of the singleton profile row: only keys present in the patch
 * are touched (`undefined` keeps the stored value, `null` clears it). The
 * `profile_touch_updated_at` trigger refreshes `updated_at`. Returns null
 * only when the sentinel row is missing (tampered schema).
 */
export function updateProfile(db: Database, patch: ProfilePatch): Profile | null {
  const sets: string[] = [];
  const bind: SQLQueryBindings[] = [];

  const column = (name: string, value: string | null): void => {
    sets.push(`${name} = ?`);
    bind.push(value);
  };

  if ('name' in patch) {
    column('name', patch.name ?? null);
  }
  if ('githubUsername' in patch) {
    column('github_username', patch.githubUsername ?? null);
  }
  if ('avatarPath' in patch) {
    column('avatar_path', patch.avatarPath ?? null);
  }
  if ('activeDatasetId' in patch) {
    sets.push('active_dataset_id = ?');
    bind.push(patch.activeDatasetId ? uuidToBytes(patch.activeDatasetId) : null);
  }

  if (sets.length > 0) {
    prepared(db, `UPDATE profile SET ${sets.join(', ')} WHERE id = ?`).run(
      ...bind,
      uuidToBytes(PROFILE_ID),
    );
  }
  return getProfile(db);
}
