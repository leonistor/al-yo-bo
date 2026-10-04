import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createCore, createVectorProvider, type CoreAi } from '@al-yo-bo/core';
import { loadSeedFixture, openDatabase, seedDatabase, setupDatabase } from '@al-yo-bo/db';
import type { Database } from 'bun:sqlite';

import { createApp } from '../src/app.ts';
import { loadConfig, type ServerConfig } from '../src/env.ts';
import { EventHub, MAX_CLIENT_QUEUE } from '../src/events.ts';

/**
 * Real-time layer tests (ARCHITECTURE §9): the SSE endpoint opens with a
 * synthetic `invalidate-all`, forwards core's coarse domain events, and stops
 * delivering when the client disconnects. These run against a real
 * `Bun.serve` — the transport the production fan-out relies on (Hono
 * `streamSSE` write scheduling is only faithful through a live socket).
 */

function stubAi(): CoreAi {
  return {
    embeddings: null,
    classifier: null,
    extract: null,
    health: {
      async report() {
        return {
          ollayaReachable: false,
          ollamaReachable: false,
          chatAvailable: false,
          chatModel: null,
          embeddingsConfigured: false,
          embeddingModel: 'stub-model',
          classifierModel: 'laya',
          extractConfigured: false,
          extractModel: null,
        };
      },
    },
  };
}

const emptyIndex = {
  size: 0,
  upsert: async () => {},
  updatePayload: async () => {},
  delete: async () => {},
  search: async () => [],
};

/** Polls `predicate` until true; fails with `label` after `timeoutMs`. */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timeout: ${label}`);
    }
    // Polling is the point — re-check the predicate on a fixed tick.
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(10);
  }
}

/**
 * Reads from the stream until a chunk containing `marker` arrives. One
 * pending read at a time (an abandoned read consumes its chunk), with an
 * overall deadline so a broken fan-out fails instead of hanging.
 */
async function readEvent(
  reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
  marker: string,
  timeoutMs = 2_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(marker)) {
    // Streaming reads are inherently sequential — each awaits the next chunk.
    // oxlint-disable-next-line no-await-in-loop
    const chunk = await Promise.race([
      reader.read(),
      Bun.sleep(timeoutMs).then(() => null),
    ]);
    if (chunk === null) {
      throw new Error(`timed out waiting for SSE event "${marker}"; received: ${JSON.stringify(text)}`);
    }
    if (chunk.done || chunk.value === undefined) {
      throw new Error(`stream closed before SSE event "${marker}"; received: ${JSON.stringify(text)}`);
    }
    text += decoder.decode(chunk.value);
  }
  return text;
}

describe('SSE events API', () => {
  let db: Database;
  let core: ReturnType<typeof createCore>;
  let hub: EventHub;
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    setupDatabase(db);
    seedDatabase(db, loadSeedFixture());
    const config: ServerConfig = loadConfig({ DATA_DIR: '/tmp/al-yo-bo-sse-test' });
    hub = new EventHub();
    core = createCore({
      db,
      config,
      ai: stubAi(),
      vector: createVectorProvider(emptyIndex, 'memory'),
      events: hub,
    });
    const app = createApp(core, config, hub);
    server = Bun.serve({ port: 0, fetch: app.fetch });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterEach(() => {
    core.stop();
    server.stop(true);
    db.close();
  });

  test('opens with invalidate-all, forwards core events, unsubscribes on disconnect', async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();

    // Reconnect semantics (§9): every connect opens with a full-invalidation
    // hint, so caches can never be stale relative to a fresh stream.
    const opening = await readEvent(reader, 'invalidate-all');
    expect(opening).toContain('event: invalidate-all');
    expect(opening).toContain('"topic":"invalidate-all"');

    // The handler registers its subscriber after the opening write; wait for
    // it before emitting, or the event would legitimately reach nobody.
    await waitFor(() => hub.subscriberCount === 1, 'subscriber registered');

    // A real core mutation fans out through the injected sink (core is the
    // only emitter — the route just forwards).
    core.bookmarks.create({ url: 'https://sse.test/live', title: 'Live' });
    const event = await readEvent(reader, 'bookmarks.changed');
    expect(event).toContain('event: bookmarks.changed');
    expect(event).toContain('"topic":"bookmarks.changed"');

    // Client disconnect stops delivery: the transport cancels the body, which
    // aborts the stream and unsubscribes the client.
    reader.cancel();
    await waitFor(() => hub.subscriberCount === 0, 'unsubscribed after disconnect');
  });

  test('an event emitted while the stream connects is still delivered', async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    const reader = response.body!.getReader();
    // No subscriberCount wait on purpose: the handler subscribes BEFORE the
    // opening write, so an emit racing the connect must not fall into the gap.
    core.bookmarks.create({ url: 'https://sse.test/race', title: 'Race' });

    const opening = await readEvent(reader, 'invalidate-all');
    expect(opening).toContain('event: invalidate-all');
    const event = await readEvent(reader, 'bookmarks.changed');
    expect(event).toContain('"topic":"bookmarks.changed"');

    reader.cancel();
    await waitFor(() => hub.subscriberCount === 0, 'unsubscribed after disconnect');
  });

  test('emitting after a disconnect is a silent no-op (events are hints, §1.6)', async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    const reader = response.body!.getReader();
    await readEvent(reader, 'invalidate-all');
    await waitFor(() => hub.subscriberCount === 1, 'subscriber registered');

    reader.cancel();
    await waitFor(() => hub.subscriberCount === 0, 'unsubscribed after disconnect');

    // Nothing is subscribed anymore: emitting must not throw and must not
    // resurrect anything — a lost event costs a refetch, never state.
    hub.emit({ topic: 'tags.changed' });
    expect(hub.subscriberCount).toBe(0);
  });

  test('a reconnected client gets a fresh invalidate-all', async () => {
    const first = await fetch(`${baseUrl}/api/events`);
    const firstReader = first.body!.getReader();
    await readEvent(firstReader, 'invalidate-all');
    await waitFor(() => hub.subscriberCount === 1, 'first subscriber registered');
    firstReader.cancel();
    await waitFor(() => hub.subscriberCount === 0, 'unsubscribed after disconnect');

    const second = await fetch(`${baseUrl}/api/events`);
    const secondReader = second.body!.getReader();
    const opening = await readEvent(secondReader, 'invalidate-all');
    expect(opening).toContain('event: invalidate-all');
    secondReader.cancel();
    await waitFor(() => hub.subscriberCount === 0, 'unsubscribed after reconnect');
  });
});

describe('EventHub slow-consumer drop', () => {
  test('a client whose write never resolves is dropped once its queue overflows', async () => {
    const hub = new EventHub();
    let closed = 0;
    // A stalled pipe: writes are accepted but never complete (the simulated
    // zero-window client the §9 slow-consumer rule protects against).
    const stalledWrites: Array<(value: void) => void> = [];
    hub.subscribe(
      (event) =>
        new Promise<void>((resolve) => {
          stalledWrites.push(resolve);
          void event;
        }),
      () => {
        closed += 1;
      },
    );

    // Burst past the bounded queue without resolving a single write.
    for (let i = 0; i <= MAX_CLIENT_QUEUE; i++) {
      hub.emit({ topic: 'jobs.changed', bookmarkId: `id-${i}` });
    }

    expect(closed).toBe(1);
    expect(hub.subscriberCount).toBe(0);

    // Subsequent emits must not throw and must not reach the dropped client.
    hub.emit({ topic: 'bookmarks.changed' });
    expect(closed).toBe(1);
    expect(stalledWrites.length).toBeLessThanOrEqual(MAX_CLIENT_QUEUE);
  });

  test('a failed write drops the client and closes its stream', async () => {
    const hub = new EventHub();
    let closed = 0;
    hub.subscribe(
      async () => {
        throw new Error('broken pipe');
      },
      () => {
        closed += 1;
      },
    );

    hub.emit({ topic: 'bookmarks.changed' });
    await Bun.sleep(20);

    expect(closed).toBe(1);
    expect(hub.subscriberCount).toBe(0);
  });
});
