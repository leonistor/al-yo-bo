import { beforeEach, describe, expect, test } from 'bun:test';

import {
  getProfile,
  openDatabase,
  PROFILE_ID,
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

  test('migration 0001 inserts the singleton row with a null-identity sentinel', () => {
    const profile = getProfile(db)!;
    expect(profile.id).toBe(PROFILE_ID);
    expect(profile.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(profile.name).toBeNull();
    expect(profile.githubUsername).toBeNull();
    expect(profile.avatarPath).toBeNull();
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

  test('the singleton row is not deletable by the query layer (no delete path exists)', () => {
    // MODEL.md principle 8: the profile is the person. There is deliberately no
    // deleteProfile function; the sentinel id stays stable across updates.
    updateProfile(db, { name: 'x' });
    expect(getProfile(db)!.id).toBe(PROFILE_ID);
  });
});
