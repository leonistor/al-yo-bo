import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { Context } from 'hono';

import type { EventsSink } from '@al-yo-bo/core';
import type { DomainEvent } from '@al-yo-bo/shared';

/**
 * Real-time layer (ARCHITECTURE §9): an in-process bus implementing core's
 * `EventsSink`. Core services are the only emitters (§4); each SSE connection
 * registers a subscriber here and `GET /api/events` fans events out.
 *
 * Events are coarse hints, never payloads of record (§1.6): nothing is
 * buffered for later replay, so a client that misses one simply converges on
 * the next refetch. The only per-client state is a small write queue, there to
 * drop stalled clients instead of buffering unboundedly.
 */

/** Events buffered per client before it is declared stalled and disconnected. */
export const MAX_CLIENT_QUEUE = 64;

/** Interval between SSE keep-alive comments on idle connections. */
export const SSE_KEEP_ALIVE_MS = 25_000;

interface Subscriber {
  queue: DomainEvent[];
  /** Serializes one event onto the client stream; must reject when the stream is broken. */
  write: (event: DomainEvent) => Promise<void>;
  /** Tears the connection down (queue overflow, failed write). */
  close: () => void;
  draining: boolean;
  /** Write accepted by the stream but not resolved yet (backpressure signal). */
  inFlight: number;
}

export class EventHub implements EventsSink {
  private subscribers = new Set<Subscriber>();

  /** Live SSE connections (observability + tests). */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Registers a client. Returns its unsubscribe function (idempotent) — the
   * SSE route calls it when the stream aborts, so a gone client never
   * accumulates events.
   */
  subscribe(write: (event: DomainEvent) => Promise<void>, close: () => void): () => void {
    const subscriber: Subscriber = { queue: [], write, close, draining: false, inFlight: 0 };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * EventsSink port — called synchronously from core services during writes,
   * so it must never throw: fan-out failures are absorbed by dropping the
   * affected client (it reconnects and receives a synthetic `invalidate-all`).
   */
  emit(event: DomainEvent): void {
    // The spread is load-bearing: dropping a stalled client mutates the set
    // mid-iteration, which Set#values() would not tolerate.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const subscriber of [...this.subscribers]) {
      // The bound covers queued AND in-flight events: a stalled pipe keeps
      // writes pending forever, so in-flight events are buffered state too.
      // Checked BEFORE the push so a client never buffers more than
      // MAX_CLIENT_QUEUE events.
      if (subscriber.queue.length + subscriber.inFlight >= MAX_CLIENT_QUEUE) {
        // Slow consumer (§9): drop it. Losing the queued hints costs nothing
        // but refetches — the reconnect's `invalidate-all` restores coherence.
        this.drop(subscriber);
        continue;
      }
      subscriber.queue.push(event);
      // One drain loop per client; emit only seeds it when idle.
      if (!subscriber.draining) {
        void this.drain(subscriber);
      }
    }
  }

  /** Drains one client's queue sequentially; a failed write drops the client. */
  private async drain(subscriber: Subscriber): Promise<void> {
    subscriber.draining = true;
    try {
      while (subscriber.queue.length > 0) {
        const event = subscriber.queue.shift();
        if (event === undefined) {
          break;
        }
        subscriber.inFlight += 1;
        try {
          // Sequential on purpose: one client's events must arrive in order.
          // oxlint-disable-next-line no-await-in-loop
          await subscriber.write(event);
        } finally {
          subscriber.inFlight -= 1;
        }
      }
    } catch {
      this.drop(subscriber);
    } finally {
      subscriber.draining = false;
      // An event may have been queued while this loop was exiting (emit saw
      // `draining === true`); re-seed instead of stalling until the next emit.
      if (subscriber.queue.length > 0 && this.subscribers.has(subscriber)) {
        void this.drain(subscriber);
      }
    }
  }

  private drop(subscriber: Subscriber): void {
    if (!this.subscribers.delete(subscriber)) {
      return;
    }
    subscriber.queue.length = 0;
    subscriber.close();
  }
}

/**
 * The `GET /api/events` handler (ARCHITECTURE §9). On every (re)connect it
 * sends a synthetic `invalidate-all` first — the client's caches can never be
 * stale relative to a stream it just opened. Each domain event is forwarded as
 * `event: <topic>` + `data: <full event JSON>`; keep-alive comments hold
 * proxies open and surface dead sockets. Unsubscribes on stream abort.
 */
export function sseEventsHandler(hub: EventHub): (c: Context) => Response {
  return (c) =>
    streamSSE(c, async (sse: SSEStreamingApi) => {
      // Reconnect semantics (§9): a fresh stream opens with a full-invalidation
      // hint, so whatever happened while the client was away gets refetched.
      await sse.writeSSE({
        event: 'invalidate-all',
        data: JSON.stringify({ topic: 'invalidate-all' } satisfies DomainEvent),
      });

      const unsubscribe = hub.subscribe(
        async (event) => {
          if (sse.aborted || sse.closed) {
            // The stream is gone — reject so the hub drops this subscriber
            // instead of draining into the void.
            throw new Error('SSE stream closed');
          }
          await sse.writeSSE({ event: event.topic, data: JSON.stringify(event) });
        },
        () => {
          // Stalled client (queue overflow) or broken write: end the stream.
          // The client sees the close, reconnects, and gets `invalidate-all`.
          sse.abort();
        },
      );
      sse.onAbort(unsubscribe);

      // Keep-alive comments (": ping") — invisible to EventSource listeners.
      // Hono swallows write errors after a disconnect; the loop exits on the
      // abort flag, which the transport sets by cancelling the response body.
      while (!sse.aborted && !sse.closed) {
        // The sleep IS the loop's purpose — pacing, not parallelizable work.
        // oxlint-disable-next-line no-await-in-loop
        await sse.sleep(SSE_KEEP_ALIVE_MS);
        if (sse.aborted || sse.closed) {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop
        await sse.write(': ping\n\n');
      }
    });
}
