import { beforeEach, describe, expect, test } from 'bun:test';

import { newIdBytes, bytesToUuid } from '@al-yo-bo/shared';

import {
  createDataset,
  deleteDataset,
  getProfile,
  openDatabase,
  PROFILE_ID,
  resolveActiveDataset,
  setupDatabase,
  updateProfile,
} from '../src/index.ts';

function freshDb() {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  return db;
}

describe('profile', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  test('migration 0007 inserts the singleton row with a null-identity sentinel', () => {
    const versions = db
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version);
    expect(versions).toContain('0007_profile.sql');

    const profile = getProfile(db)!;
    expect(profile.id).toBe(PROFILE_ID);
    expect(profile.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(profile.name).toBeNull();
    expect(profile.githubUsername).toBeNull();
    expect(profile.avatarPath).toBeNull();
    expect(profile.activeDatasetId).toBeNull();
    expect(profile.createdAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('partial patches touch only provided keys; null clears', () => {
    updateProfile(db, { name: 'Leo', githubUsername: 'leonistor' });
    let profile = getProfile(db)!;
    expect(profile.name).toBe('Leo');
    expect(profile.githubUsername).toBe('leonistor');

    // An empty patch is a no-op that still returns the fresh row.
    expect(updateProfile(db, {})?.name).toBe('Leo');

    updateProfile(db, { name: null });
    profile = getProfile(db)!;
    expect(profile.name).toBeNull();
    expect(profile.githubUsername).toBe('leonistor');
  });

  test('updates refresh updated_at via the trigger', async () => {
    const before = getProfile(db)!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateProfile(db, { name: 'Leo' });
    const after = getProfile(db)!;
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.createdAt).toBe(before.createdAt);
  });

  test('activeDatasetId must reference an existing dataset (FK enforced)', () => {
    const phantom = bytesToUuid(newIdBytes());
    expect(() => updateProfile(db, { activeDatasetId: phantom })).toThrow();
  });

  test('deleting the active dataset nulls the pointer instead of the profile', () => {
    const dataset = createDataset(db, 'workspace');
    updateProfile(db, { activeDatasetId: dataset.id });
    expect(getProfile(db)!.activeDatasetId).toBe(dataset.id);

    deleteDataset(db, dataset.id);
    const profile = getProfile(db)!;
    expect(profile.activeDatasetId).toBeNull();
    expect(profile.id).toBe(PROFILE_ID);
  });

  test('resolver: the profile pointer wins over the config fallback name', () => {
    const grimoire = createDataset(db, 'grimoire');
    updateProfile(db, { activeDatasetId: grimoire.id });

    const resolved = resolveActiveDataset(db, 'default');
    expect(resolved.source).toBe('profile');
    expect(resolved.created).toBe(false);
    expect(resolved.dataset.id).toBe(grimoire.id);
  });

  test('resolver: a dangling pointer falls through to the config name', () => {
    const stale = createDataset(db, 'gone');
    updateProfile(db, { activeDatasetId: stale.id });
    deleteDataset(db, stale.id);

    const resolved = resolveActiveDataset(db, 'fallback');
    expect(resolved.source).toBe('config');
    expect(resolved.dataset.name).toBe('fallback');
  });

  test('resolver: without a pointer, the config name is used and created on demand', () => {
    const resolved = resolveActiveDataset(db, 'fresh');
    expect(resolved.source).toBe('config');
    expect(resolved.created).toBe(true);
    expect(resolved.dataset.name).toBe('fresh');

    const again = resolveActiveDataset(db, 'fresh');
    expect(again.created).toBe(false);
  });
});
