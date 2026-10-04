import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCore, createVectorProvider } from '@al-yo-bo/core';
import { sha256Hex, startJobQueue } from '@al-yo-bo/core';
import { createBookmark, createTag, getBookmarkById } from '@al-yo-bo/db';

import {
  StubVectorIndex,
  makeDb,
  recordingEvents,
  stubAi,
  stubClassifier,
  testConfig,
} from './support.ts';

/**
 * Event-emission layer tests (ARCHITECTURE §9, H5): core services are the ONLY
 * emitters, every mutating operation publishes its coarse topic, and payloads
 * are hints.
 */
describe('domain events', () => {
  test('bookmark mutations emit bookmarks.changed', async () => {
    const db = makeDb();
    const events = recordingEvents();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
      events,
    });
    // Stop the queue upfront: this test asserts direct-mutation emits only,
    // and the scrape job enqueued by `create` would otherwise interleave its
    // own (asynchronous) hints — queue-path emits have their own tests below.
    core.stop();
    try {
      const created = core.bookmarks.create({ url: 'https://example.com/ev', title: 'Ev' });
      await core.bookmarks.update(created.id, { title: 'Ev 2' });
      await core.bookmarks.delete(created.id);

      // Each mutation emitted exactly one hint.
      const topics = events.events
        .filter((event) => event.topic === 'bookmarks.changed')
        .map((event) => event.topic);
      expect(topics).toEqual(['bookmarks.changed', 'bookmarks.changed', 'bookmarks.changed']);
    } finally {
      core.stop();
    }
  });

  test('vocabulary mutations emit categories.changed / tags.changed', () => {
    const db = makeDb();
    const events = recordingEvents();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
      events,
    });
    try {
      core.vocabulary.createCategory({ name: 'Dev' });
      core.vocabulary.createTag({ name: 'rust' });

      const topics = events.events.map((event) => event.topic);
      expect(topics).toEqual(['categories.changed', 'tags.changed']);
    } finally {
      core.stop();
    }
  });

  test('import commit emits bookmarks + categories + tags changed', async () => {
    const db = makeDb();
    const events = recordingEvents();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
      events,
    });
    // Stop the queue upfront (same reason as above): commit enqueues scrape
    // jobs whose queue-path hints must not interleave the commit's own emits.
    core.stop();
    try {
      const { bookmarks } = await core.import.preview('## Dev\n- https://example.com/a\n');
      core.import.commit(bookmarks);

      const topics = events.events.map((event) => event.topic).toSorted();
      expect(topics).toEqual(['bookmarks.changed', 'categories.changed', 'tags.changed']);
    } finally {
      core.stop();
    }
  });

  test('profile updates emit profile.changed', () => {
    const db = makeDb();
    const events = recordingEvents();
    const core = createCore({
      db,
      config: testConfig(),
      ai: stubAi(),
      vector: createVectorProvider(new StubVectorIndex(), 'memory'),
      events,
    });
    try {
      core.profile.update({ name: 'Octocat' });
      expect(events.events.map((event) => event.topic)).toEqual(['profile.changed']);
    } finally {
      core.stop();
    }
  });

  test('the job queue emits jobs.changed on enqueue and completion', async () => {
    const db = makeDb();
    const events = recordingEvents();
    const queue = startJobQueue({
      db,
      vector: new StubVectorIndex(),
      scrape: async () => ({
        content: '# Page',
        contentHash: sha256Hex('# Page'),
        metadata: { scrape: { at: 1, contentType: 'text/html', finalUrl: null, truncated: false } },
      }),
      config: testConfig(),
      baseDelayMs: 1,
      events,
    });

    const { id } = createBookmark(db, { url: 'https://example.com/jobbed', title: 'J' });
    queue.enqueue(id, 'scrape');
    await queue.waitForIdle();
    queue.stop();

    // The scrape chains embed + screenshot, so those emit their own hints; the
    // scrape job itself is hinted exactly twice (enqueue + completion).
    const scrapeEvents = events.events.filter(
      (event) => event.topic === 'jobs.changed' && event.job === 'scrape',
    );
    expect(scrapeEvents).toHaveLength(2);
    expect(scrapeEvents[0]).toEqual({ topic: 'jobs.changed', bookmarkId: id, job: 'scrape' });
    expect(scrapeEvents[1]).toEqual({ topic: 'jobs.changed', bookmarkId: id, job: 'scrape' });
    // Every chained job was hinted at least once too (embed enqueue is a
    // no-op completion without an embedding client, so 5 hints total here).
    expect(
      events.events.filter((event) => event.topic === 'jobs.changed').length,
    ).toBeGreaterThanOrEqual(5);

    // The scrape changed the row — queue jobs also hint bookmarks.changed so
    // background enrichment surfaces in the UI (the chained embed/screenshot
    // jobs skipped without row changes, hence exactly one hint).
    expect(events.events.filter((event) => event.topic === 'bookmarks.changed')).toEqual([
      { topic: 'bookmarks.changed', bookmarkIds: [id] },
    ]);
  });

  test('a failed scrape job emits bookmarks.changed for the error-surface row change', async () => {
    const db = makeDb();
    const events = recordingEvents();
    const queue = startJobQueue({
      db,
      vector: new StubVectorIndex(),
      scrape: async () => {
        throw new Error('boom');
      },
      maxAttempts: 1,
      config: testConfig(),
      baseDelayMs: 1,
      events,
    });

    const { id } = createBookmark(db, { url: 'https://example.com/ev-failed' });
    queue.enqueue(id, 'scrape');
    await queue.waitForIdle();
    queue.stop();

    // The failure persisted metadata.scrape.lastError — a row change the UI
    // error surface must see.
    expect(events.events.filter((event) => event.topic === 'bookmarks.changed')).toEqual([
      { topic: 'bookmarks.changed', bookmarkIds: [id] },
    ]);
    expect(getBookmarkById(db, id)!.metadata?.scrape).toBeDefined();
  });

  test('a classify job that changes assignments emits bookmarks.changed', async () => {
    const db = makeDb();
    createTag(db, { name: 'rust' });
    const events = recordingEvents();
    const queue = startJobQueue({
      db,
      vector: new StubVectorIndex(),
      scrape: async () => {
        throw new Error('unused');
      },
      classifier: stubClassifier({ rust: 0.9 }),
      config: testConfig(),
      baseDelayMs: 1,
      events,
    });

    const { id } = createBookmark(db, {
      url: 'https://example.com/ev-classify',
      title: 'C',
      content: 'Body',
    });
    queue.enqueue(id, 'classify');
    await queue.waitForIdle();
    queue.stop();

    expect(events.events.filter((event) => event.topic === 'bookmarks.changed')).toEqual([
      { topic: 'bookmarks.changed', bookmarkIds: [id] },
    ]);
  });

  test('a screenshot job that captures emits bookmarks.changed', async () => {
    const db = makeDb();
    const events = recordingEvents();
    const dir = await mkdtemp(join(tmpdir(), 'al-yo-bo-events-shot-'));
    try {
      const queue = startJobQueue({
        db,
        vector: new StubVectorIndex(),
        scrape: async () => {
          throw new Error('unused');
        },
        screenshotsDir: dir,
        screenshot: {
          async capture() {
            return { buffer: Buffer.from('jpeg-bytes'), ogImageUrl: null };
          },
        },
        config: testConfig(),
        baseDelayMs: 1,
        events,
      });

      const { id } = createBookmark(db, { url: 'https://example.com/ev-shot' });
      queue.enqueue(id, 'screenshot');
      await queue.waitForIdle();
      queue.stop();

      expect(events.events.filter((event) => event.topic === 'bookmarks.changed')).toEqual([
        { topic: 'bookmarks.changed', bookmarkIds: [id] },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
