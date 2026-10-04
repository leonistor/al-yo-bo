import type { Database } from 'bun:sqlite';

import { getBookmarkById } from '@al-yo-bo/db';
import type { BookmarkWithTags, VectorIndex } from '@al-yo-bo/shared';

import type { CoreAi } from '../ai.ts';
import type { CoreConfig } from '../config.ts';
import { classifyBookmark, type ClassifyOutcome } from '../enrichment/classify.ts';
import {
  reconcileEnrichment,
  scrapeAndStore,
  screenshotAndStore,
  startJobQueue,
  type JobQueue,
  type JobType,
  type ReconcileReport,
  type ScrapeOutcome,
  type ScreenshotOutcome,
} from '../enrichment/jobs.ts';
import { DomainError, NotFoundError } from '../errors.ts';
import type { EventsSink } from '../events.ts';
import { ScrapeError, type ScrapeFn } from '../scrape.ts';
import type { ScreenshotClient } from '../screenshot.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { bookmarkViewOrThrow } from './_views.ts';

/**
 * Minimal scheduling port other services depend on. It is deliberately tiny so
 * they never reach for the full queue (waitForIdle/stop), and so tests can pass
 * a recording stub. `EnrichmentService` is its production implementation.
 */
export interface JobScheduler {
  enqueue(bookmarkId: string, type: JobType): void;
}

export interface EnrichmentServiceDeps {
  db: Database;
  config: CoreConfig;
  ai: CoreAi;
  vector: VectorProvider;
  /** Absent = the manual scrape endpoint reports unavailable and scrape jobs fail. */
  scrape?: ScrapeFn;
  /** Screenshot capture port; absent = screenshot jobs are a no-op. */
  screenshot?: ScreenshotClient | null;
  /** Absolute path the screenshot job writes image bytes to. */
  screenshotsDir?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  events: EventsSink;
}

export interface ScrapeResponse {
  status: ScrapeOutcome;
  bookmark: BookmarkWithTags;
}

export interface ClassifyResponse extends ClassifyOutcome {
  bookmark: BookmarkWithTags;
}

export interface ScreenshotResponse {
  status: ScreenshotOutcome;
  bookmark: BookmarkWithTags;
}

export interface EnrichmentService extends JobScheduler {
  pendingCount(): number;
  /** Resolves when no job is queued or running (test/drain helper). */
  waitForIdle(): Promise<void>;
  stop(): void;
  /** Capability probes so the app edge can decide whether an endpoint is served. */
  readonly scrapeAvailable: boolean;
  readonly classifierAvailable: boolean;
  readonly screenshotAvailable: boolean;
  /** Manual scrape for one bookmark; maps scrape failures to domain errors. */
  scrape(id: string): Promise<ScrapeResponse>;
  /** Manual classification for one bookmark; maps failures to domain errors. */
  classify(id: string): Promise<ClassifyResponse>;
  /** Manual screenshot capture for one bookmark; returns 'skipped' when no client. */
  screenshot(id: string): Promise<ScreenshotResponse>;
  reconcile(): ReconcileReport;
}

/**
 * A stable `VectorIndex` that always delegates to the provider's current index.
 * The queue is built once, but a `reindex` may replace the serving stack at any
 * time — reading `current()` per operation keeps queued work on the live index.
 */
function routingVector(provider: VectorProvider): VectorIndex {
  return {
    get size() {
      return provider.current().size;
    },
    upsert: (point) => provider.current().upsert(point),
    updatePayload: (bookmarkId, patch) => provider.current().updatePayload(bookmarkId, patch),
    delete: (bookmarkId) => provider.current().delete(bookmarkId),
    search: (query, topK, filter) => provider.current().search(query, topK, filter),
  };
}

/** Enabled only when deps are configured; every capability degrades (§1.5). */
export function createEnrichmentService(deps: EnrichmentServiceDeps): EnrichmentService {
  const { db, config, ai, vector, scrape, screenshot, events } = deps;
  const { embeddings, classifier } = ai;

  // The queue chains scrape → embed → classify and is the JobScheduler other
  // services receive. `queue` is referenced from the onEmbedded hook, which only
  // fires after a job runs, by which point the assignment has happened.
  let queue!: JobQueue;
  queue = startJobQueue({
    db,
    vector: routingVector(vector),
    embeddings: embeddings ?? undefined,
    // With no scrape capability the queue still exists (embed/classify work);
    // scrape jobs fail as transient and are dropped after the retry cap.
    scrape:
      scrape ??
      (async () => {
        throw new ScrapeError('Scraping is not available');
      }),
    screenshot: screenshot ?? null,
    screenshotsDir: deps.screenshotsDir,
    classifier: classifier ?? undefined,
    config,
    maxAttempts: deps.maxAttempts ?? config.scrape.maxAttempts,
    baseDelayMs: deps.baseDelayMs,
    // Content changes flow scrape → embed → classify (§7 stage 6 re-run triggers).
    onEmbedded: (bookmarkId) => queue.enqueue(bookmarkId, 'classify'),
    // Coarse job-progress hints fan out through the injected sink (§9).
    events,
  });

  /**
   * Manual endpoints run outside the queue, so the queue's `jobs.changed`
   * hints do not cover them. Instead they emit `bookmarks.changed` when the
   * operation actually changed the bookmark row (content, tags, image) — the
   * response already carries the fresh bookmark for the caller.
   */
  return {
    enqueue: (bookmarkId, type) => queue.enqueue(bookmarkId, type),
    pendingCount: () => queue.pendingCount(),
    waitForIdle: () => queue.waitForIdle(),
    stop: () => queue.stop(),

    get scrapeAvailable() {
      return Boolean(scrape);
    },
    get classifierAvailable() {
      return Boolean(classifier);
    },
    get screenshotAvailable() {
      return Boolean(screenshot);
    },

    async scrape(id) {
      if (!getBookmarkById(db, id)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!scrape) {
        throw new DomainError('Scraping is not available', 'scrape_unavailable');
      }
      try {
        const status = await scrapeAndStore(
          {
            db,
            // Resolved at call time so a reindexed stack is used.
            vector: vector.current(),
            embeddings: embeddings ?? undefined,
            scrape,
            config,
            // Chains the embed job into the same queue the worker drains.
            queue,
          },
          id,
        );
        if (status !== 'missing') {
          events.emit({ topic: 'bookmarks.changed', bookmarkIds: [id] });
        }
        return { status, bookmark: bookmarkViewOrThrow(db, id) };
      } catch (error) {
        // scrapeAndStore persisted `metadata.scrape.lastError` before
        // throwing — hint the row change so other clients see the error
        // surface refresh, even though this caller gets the error directly.
        events.emit({ topic: 'bookmarks.changed', bookmarkIds: [id] });
        if (error instanceof ScrapeError) {
          throw new DomainError(error.message, 'scrape_failed');
        }
        throw error;
      }
    },

    async classify(id) {
      if (!getBookmarkById(db, id)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!classifier) {
        throw new DomainError('Classification is not available', 'classify_unavailable');
      }
      try {
        const outcome = await classifyBookmark(
          { db, vector: vector.current(), classifier, config },
          id,
        );
        if (outcome.assigned > 0 || outcome.retracted > 0) {
          events.emit({ topic: 'bookmarks.changed', bookmarkIds: [id] });
        }
        return { ...outcome, bookmark: bookmarkViewOrThrow(db, id) };
      } catch (error) {
        throw new DomainError(
          `Classification failed: ${error instanceof Error ? error.message : error}`,
          'classify_failed',
        );
      }
    },

    async screenshot(id) {
      if (!getBookmarkById(db, id)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!screenshot) {
        return { status: 'skipped', bookmark: bookmarkViewOrThrow(db, id) };
      }
      try {
        const status = await screenshotAndStore(
          {
            db,
            vector: vector.current(),
            embeddings: embeddings ?? undefined,
            scrape:
              scrape ??
              (async () => {
                throw new ScrapeError('Scraping is not available');
              }),
            screenshot,
            screenshotsDir: deps.screenshotsDir,
            config,
            queue,
          },
          id,
        );
        if (status === 'captured') {
          // Only a capture changes the row (`metadata.image`).
          events.emit({ topic: 'bookmarks.changed', bookmarkIds: [id] });
        }
        return { status, bookmark: bookmarkViewOrThrow(db, id) };
      } catch (error) {
        throw new DomainError(
          `Screenshot failed: ${error instanceof Error ? error.message : error}`,
          'screenshot_failed',
        );
      }
    },

    reconcile() {
      return reconcileEnrichment(
        queue,
        db,
        embeddings ? config.embeddings.model : undefined,
        Boolean(screenshot),
      );
    },
  };
}
