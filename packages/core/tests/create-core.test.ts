import { describe, expect, test } from 'bun:test';

import type { Database } from 'bun:sqlite';

import { createCore, createVectorProvider } from '@al-yo-bo/core';
import { createDataset, getDatasetByName, openDatabase, setupDatabase, updateProfile } from '@al-yo-bo/db';

import { StubVectorIndex, testConfig } from './support.ts';

function makeDb(): Database {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  return db;
}

/** Boot-time active-dataset resolution is the one thing createCore owns. */
describe('createCore active-dataset resolution', () => {
  test('the profile pointer wins over the config fallback name', () => {
    const db = makeDb();
    const grimoire = createDataset(db, 'grimoire');
    updateProfile(db, { activeDatasetId: grimoire.id });

    const core = createCore({
      db,
      config: testConfig({ defaultDataset: 'test' }),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
    });
    try {
      expect(core.defaultDatasetId).toBe(grimoire.id);
    } finally {
      core.stop();
    }
  });

  test('falls back to the config name, creating it on demand', () => {
    const db = makeDb();
    const core = createCore({
      db,
      config: testConfig({ defaultDataset: 'boot-fallback' }),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
    });
    try {
      expect(core.defaultDatasetId).toBe(getDatasetByName(db, 'boot-fallback')!.id);
    } finally {
      core.stop();
    }
  });
});
