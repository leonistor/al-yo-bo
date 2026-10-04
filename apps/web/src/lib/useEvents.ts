import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys } from '@/lib/queryKeys';

/**
 * Real-time layer (ARCHITECTURE §9): one EventSource per mounted app maps the
 * server's coarse domain events onto TanStack Query invalidations.
 *
 * Wire contract (server `apps/server/src/events.ts`): every event travels as a
 * *named* SSE event (`event: <topic>` + `data: <full event JSON>`), so
 * `onmessage` never fires — each topic needs its own `addEventListener`.
 * Keep-alives are `: ping` comments, invisible to listeners.
 *
 * Lossy-by-design semantics (§9): an event is only a refetch hint, never a
 * payload of record. Nothing is replayed after a disconnect, which is why the
 * recovery paths invalidate broadly:
 *
 * - `invalidate-all` (sent synthetically by the server on every (re)connect)
 *   → unfiltered `queryClient.invalidateQueries()`.
 * - `error` → unfiltered invalidation as well; the browser reopens the stream
 *   automatically, and if it reports CLOSED (server gone, bad handshake) this
 *   hook reconnects itself with a small fixed backoff.
 * - Watchdog → because keep-alive comments are invisible to JS, a stream that
 *   stalls while staying OPEN (observed through the Vite dev proxy: events
 *   stop, no `error` ever fires) is indistinguishable from idle. If no named
 *   event arrives within `STALL_TIMEOUT_MS` (~5 missed keep-alive intervals)
 *   the stream is recycled: a fresh open provably delivers events and carries
 *   its own `invalidate-all`. The cost when the app is truly idle is one
 *   reconnect + refetch per threshold window — bounded, and far cheaper than
 *   silently stale UI (convergence is the §9 contract).
 *
 * StrictMode safety: the effect's cleanup closes whatever stream instance is
 * current, so the dev double-mount opens at most one live subscription at a
 * time instead of leaking a second one.
 */

const EVENT_SOURCE_URL = '/api/events';

/** Reconnect delay when the browser gives up (readyState CLOSED). */
const RECONNECT_DELAY_MS = 2000;

/** How often the staleness watchdog checks the stream. */
const WATCHDOG_INTERVAL_MS = 30_000;

/**
 * Silence after which the stream is force-recycled (~5 missed 25s keep-alive
 * intervals — server `SSE_KEEP_ALIVE_MS`).
 */
const STALL_TIMEOUT_MS = 120_000;

/**
 * Events arriving in a burst (e.g. one `jobs.changed` per enrichment step)
 * collapse into a single invalidation pass per key prefix within this window.
 */
const BATCH_WINDOW_MS = 100;

/** Topics the server fans out; each needs a named listener (`onmessage` never fires). */
const TOPICS = [
  'bookmarks.changed',
  'categories.changed',
  'tags.changed',
  'profile.changed',
  'jobs.changed',
  'invalidate-all',
] as const;

/**
 * Topic → the query-key prefixes a matching event may have staled. The
 * review-candidates key rides alongside bookmark/tag data everywhere here:
 * below-threshold suggestions derive from classification runs, so they
 * appear/disappear with the same row changes.
 */
function topicInvalidations(topic: string): readonly (readonly string[])[] {
  switch (topic) {
    case 'bookmarks.changed':
      return [queryKeys.bookmarks.all, queryKeys.aggregates, queryKeys.candidates];
    case 'categories.changed':
      return [queryKeys.categories, queryKeys.aggregates];
    case 'tags.changed':
      // List rows render tag names, so a vocabulary edit stales bookmarks too.
      return [queryKeys.tags, queryKeys.bookmarks.all, queryKeys.aggregates, queryKeys.candidates];
    case 'profile.changed':
      return [queryKeys.profile];
    case 'jobs.changed':
      // Job progress surfaces as the pending count in the health panel.
      // Background jobs also mutate bookmark rows (scrape/classify/screenshot);
      // the batched invalidation machinery above dedupes the storm, so mapping
      // the coarse hint onto bookmark data keeps enrichment visible even for
      // row changes the per-job `bookmarks.changed` burst might drop.
      return [queryKeys.health, queryKeys.bookmarks.all, queryKeys.candidates];
    default:
      return [];
  }
}

/** Registers the stream's listeners; returns the teardown. */
function connect(queryClient: QueryClient): () => void {
  // Reassigned on recycle; the teardown always closes whichever instance is
  // current so neither a self-heal nor a watchdog recycle can leak a stream.
  let source = new EventSource(EVENT_SOURCE_URL);
  let lastEventAt = Date.now();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;

  const pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    for (const prefix of pending) {
      void queryClient.invalidateQueries({ queryKey: JSON.parse(prefix) });
    }
    pending.clear();
  };

  const invalidate = (...prefixes: readonly (readonly string[])[]) => {
    for (const prefix of prefixes) {
      // String keys so the pending set dedupes structurally identical prefixes.
      pending.add(JSON.stringify(prefix));
    }
    if (flushTimer === null) {
      flushTimer = setTimeout(flush, BATCH_WINDOW_MS);
    }
  };

  const invalidateEverything = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending.clear();
    void queryClient.invalidateQueries();
  };

  const onTopic = (event: MessageEvent<string>) => {
    lastEventAt = Date.now();
    if (event.type === 'invalidate-all') {
      invalidateEverything();
      return;
    }
    const invalidations = topicInvalidations(event.type);
    if (invalidations.length > 0) {
      invalidate(...invalidations);
    }
  };

  const onError = () => {
    // §9: a stream error means the client may have missed hints while
    // disconnected — refetch unconditionally (the reopen's synthetic
    // `invalidate-all` then doubles as a second safety net).
    invalidateEverything();
    if (source.readyState === EventSource.CLOSED) {
      // The browser stopped retrying (server unreachable at connect time);
      // self-heal with a fixed backoff instead of staying dark.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openStream();
      }, RECONNECT_DELAY_MS);
    }
  };

  const attach = () => {
    // Named events only: `onmessage` would never fire for the server's topics.
    for (const topic of TOPICS) {
      source.addEventListener(topic, onTopic as EventListener);
    }
    source.addEventListener('error', onError);
  };

  const openStream = () => {
    source = new EventSource(EVENT_SOURCE_URL);
    lastEventAt = Date.now();
    attach();
  };

  const recycle = () => {
    source.close();
    openStream();
    // The recycled stream's `invalidate-all` converges the caches; invalidate
    // here too in case the fresh open itself fails (its error handler then
    // covers retrying).
    invalidateEverything();
  };

  attach();

  watchdogTimer = setInterval(() => {
    if (Date.now() - lastEventAt >= STALL_TIMEOUT_MS) {
      recycle();
    }
  }, WATCHDOG_INTERVAL_MS);

  return () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
    }
    if (watchdogTimer !== null) {
      clearInterval(watchdogTimer);
    }
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
    }
    pending.clear();
    source.close();
  };
}

/** Subscribes the app to `/api/events` for the lifetime of the mounted tree. */
export function useEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => connect(queryClient), [queryClient]);
}
