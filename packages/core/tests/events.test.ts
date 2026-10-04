import { describe, expect, test } from 'bun:test';

import { createCore, createVectorProvider } from '@al-yo-bo/core';
import { sha256Hex, startJobQueue } from '@al-yo-bo/core';
import { createBookmark } from '@al-yo-bo/db';

import { StubVectorIndex, makeDb, recordingEvents, stubAi, testConfig } from './support.ts';

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
    try {
      const created = core.bookmarks.create({ url: 'https://example.com/ev', title: 'Ev' });
      await core.bookmarks.update(created.id, { title: 'Ev 2' });
      await core.bookmarks.delete(created.id);

      // The scrape enqueued by create also emits jobs.changed — filter to the
      // bookmark topic; each mutation emitted exactly one hint.
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
    try {
      const { bookmarks } = await core.import.preview('## Dev\n- https://example.com/a\n');
      core.import.commit(bookmarks);

      const topics = events.events
        .filter((event) => event.topic !== 'jobs.changed')
        .map((event) => event.topic)
        .toSorted();
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
  });
});
