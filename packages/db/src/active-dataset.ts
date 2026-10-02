import type { Database } from 'bun:sqlite';

import type { Dataset } from '@al-yo-bo/shared';

import { createDataset, getDatasetById, getDatasetByName } from './queries/datasets.ts';
import { getProfile } from './queries/profile.ts';

export interface ResolvedActiveDataset {
  dataset: Dataset;
  /** Where the pointer came from — surfaced for boot logs and tests. */
  source: 'profile' | 'config';
  /** True when the fallback dataset did not exist and was created on demand. */
  created: boolean;
}

/**
 * The active-dataset precedence — one source of truth for the server boot, the
 * CLI scripts, and the profile API (MODEL.md principle 8):
 *
 * 1. the profile's `active_dataset_id` pointer (set by `PATCH /api/profile`
 *    or by `db:seed` activation) — switching datasets is a data operation, not
 *    an env edit plus a restart;
 * 2. the configured fallback name (`DEFAULT_DATASET`, default `default`),
 *    created on demand so a fresh database always has a scoping dataset.
 *
 * A dangling pointer (its dataset was deleted — `ON DELETE SET NULL` normally
 * prevents this, but a tampered row could) falls through to the config name
 * instead of failing boot.
 */
export function resolveActiveDataset(
  db: Database,
  fallbackName: string,
): ResolvedActiveDataset {
  const profile = getProfile(db);
  if (profile?.activeDatasetId) {
    const dataset = getDatasetById(db, profile.activeDatasetId);
    if (dataset) {
      return { dataset, source: 'profile', created: false };
    }
  }
  const existing = getDatasetByName(db, fallbackName);
  const dataset = existing ?? createDataset(db, fallbackName);
  return { dataset, source: 'config', created: !existing };
}
