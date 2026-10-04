import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { createCore, createVectorProvider } from '@al-yo-bo/core';
import { createBookmark, getProfile, updateProfile } from '@al-yo-bo/db';

import { StubVectorIndex, makeDb, stubAi, testConfig } from './support.ts';

/** Boot smoke test for the v2 composition root (no dataset resolution anymore). */
describe('createCore boot', () => {
  test('wires every service over an open db + injected ports', async () => {
    const db: Database = makeDb();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
    });
    try {
      // The migration seeds the singleton profile; identity-only (no dataset pointer).
      expect(core.profile.get()).not.toBeNull();
      expect(getProfile(db)!.name).toBeNull();

      // Read paths answer without any sidecar.
      expect(core.search.aggregates().total).toBe(0);

      // reindex rebuilds FTS from the bookmarks table.
      createBookmark(db, { url: 'https://example.com/a', title: 'Booted' });
      const report = await core.reindex();
      expect(report).toEqual({ ftsRows: 1, vectorBackend: 'memory' });
    } finally {
      core.stop();
    }
  });

  test('the default events sink is a silent no-op', () => {
    const db = makeDb();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
    });
    try {
      // No sink injected: mutations must not throw for lack of a bus (H5).
      const created = core.bookmarks.create({ url: 'https://example.com/quiet' });
      expect(created.url).toBe('https://example.com/quiet');
    } finally {
      core.stop();
    }
  });

  test('services share one enrichment scheduler (enqueue dedupes across services)', () => {
    const db = makeDb();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
    });
    try {
      const created = core.bookmarks.create({ url: 'https://example.com/shared' });
      // Same instance backs core.enrichment and the services' JobScheduler port.
      core.enrichment.enqueue(created.id, 'classify');
      expect(core.enrichment.pendingCount()).toBeGreaterThanOrEqual(1);
    } finally {
      core.stop();
    }
  });

  test('profile update normalizes the github username', () => {
    const db = makeDb();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
    });
    try {
      const profile = core.profile.update({ githubUsername: '@octocat' });
      expect(profile.githubUsername).toBe('octocat'); // the '@' is stripped
      updateProfile(db, { name: 'Octocat' });
      expect(core.profile.get()!.name).toBe('Octocat');
    } finally {
      core.stop();
    }
  });
});

describe('createCore — health composition', () => {
  test('composes vector backend, ai probes, scrape binary check and screenshot flag', async () => {
    const db = makeDb();
    const core = createCore({
      db,
      // A binary that cannot resolve → scrape reports unavailable even though
      // a scraper was injected (the ladder shells out to this binary, §10).
      config: testConfig({ scrape: { ...testConfig().scrape, binary: 'no-such-binary-xyz' } }),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(['a', 'b']), 'memory'),
      scrape: async () => {
        throw new Error('unused');
      },
      screenshot: {
        async capture() {
          return null;
        },
      },
    });
    try {
      const report = await core.health.health();
      expect(report.status).toBe('ok');
      expect(report.vector).toEqual({ backend: 'memory', indexed: 2 });
      expect(report.ai.embeddingModel).toBe('stub-model');
      expect(report.enrichment.scrapeAvailable).toBe(false);
      expect(report.screenshot.available).toBe(true);
    } finally {
      core.stop();
    }
  });
});
