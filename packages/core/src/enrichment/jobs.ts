// Awaiting inside loops is deliberate throughout this module: the pump drains
// one job at a time, retries sleep with exponential backoff, and embed batches
// write SQLite-first then the vector index. Parallelizing would change the
// sidecar load profile and per-job failure semantics. (A block disable without
// a matching enable covers the rest of the file; `oxlint-disable-file` proved
// unreliable with preceding comments.)
// oxlint-disable eslint/no-await-in-loop

/**
 * In-process job loop (ARCHITECTURE §10): sequential, idempotent jobs with
 * bounded retries, deduplicated per (bookmark, type). The queue is deliberately
 * in-memory — SQLite holds the durable state that defines what still needs
 * doing, so `reconcileEnrichment` at startup recovers anything a restart
 * dropped.
 *
 * Job types (§10 table):
 * - `scrape`     — page → content/metadata/content_hash; chains embed + screenshot
 * - `embed`      — content → vector (SQLite BLOB first, then the serving index);
 *                  chains `classify` via `onEmbedded`
 * - `classify`   — content → tag assignments via Ollaya
 * - `screenshot` — page → image bytes written to `data/screenshots/<uuid>.jpg`
 *
 * The screenshot job is independent of scrape: it fetches the page itself via
 * the injected `ScreenshotClient`, stores the buffer under `data/screenshots/`,
 * and records both the local path and the discovered `og:image` URL on
 * `metadata.image`. A failed screenshot never invalidates the bookmark —
 * reconciliation retries on the next start.
 *
 * Every enqueue and completed job emits a coarse `jobs.changed` hint
 * (ARCHITECTURE §9) when an events sink is provided. A job that actually
 * mutates the bookmark row (scraped content, assigned tags, captured image —
 * and failed scrapes, which write `metadata.scrape.lastError`) additionally
 * emits `bookmarks.changed` with the id, so background enrichment storms
 * surface in the UI the same way the manual endpoints do. Both hints are
 * lossy by design — they only trigger UI refetches.
 */

import type { Database } from 'bun:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EmbeddingClient } from '@al-yo-bo/ai';
import {
  getBookmarkById,
  getBookmarksWithTagsByIds,
  listBookmarkIdsMissingContent,
  listBookmarkIdsMissingEmbeddings,
  listBookmarkIdsMissingScreenshot,
  listEmbeddingModelMismatches,
  parseBookmarkImage,
  updateBookmark,
  upsertEmbedding,
} from '@al-yo-bo/db';
import { packFloat32, type BookmarkWithTags, type VectorIndex } from '@al-yo-bo/shared';

import type { CoreConfig } from '../config.ts';
import type { EventsSink } from '../events.ts';
import { ScrapeError, type ScrapeFn, type ScrapeResult } from '../scrape.ts';
import type { ScreenshotClient, ScreenshotResult } from '../screenshot.ts';
import { classifyBookmark, type ClassifyDeps } from './classify.ts';

export type JobType = 'scrape' | 'embed' | 'classify' | 'screenshot';

/** Char budget for the composed embed text (~2k tokens, under common model limits). */
export const EMBED_TEXT_CHAR_LIMIT = 8_000;

export interface JobDeps {
  db: Database;
  vector: VectorIndex;
  embeddings?: EmbeddingClient;
  scrape: ScrapeFn;
  /**
   * Absolute path the screenshot job writes image bytes to. Injected by the
   * app edge (server env, derived from `DATA_DIR`); the job skips when absent
   * rather than guessing a cwd-relative path.
   */
  screenshotsDir?: string;
  /** Screenshot capture port; absent = screenshot job is a no-op. */
  screenshot?: ScreenshotClient | null;
  /** Core configuration (embedding model identity, scrape options). */
  config: CoreConfig;
  /** The queue itself, so job handlers can chain the next job type. Optional in workerless contexts. */
  queue?: JobQueue;
}

export interface JobQueue {
  enqueue(bookmarkId: string, type: JobType): void;
  pendingCount(): number;
  /** Resolves when no job is queued or running (test/drain helper). */
  waitForIdle(): Promise<void>;
  /** Best-effort stop: the in-flight job finishes, queued jobs are dropped. */
  stop(): void;
}

export interface JobQueueOptions extends Omit<JobDeps, 'queue'> {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Called after a successful embed write — the classification trigger (§7 stage 6). */
  onEmbedded?: (bookmarkId: string) => void;
  /** Classification subsystem; absent = classification stays off (§1.5). */
  classifier?: ClassifyDeps['classifier'];
  /** Core configuration (threshold, Ollaya model) for the classify job. */
  config: CoreConfig;
  /**
   * Receives the coarse hints (ARCHITECTURE §9): `jobs.changed` on enqueue and
   * completion, plus `bookmarks.changed` when a job mutates the bookmark row.
   * Absent = silent.
   */
  events?: EventsSink;
}

/**
 * Title + description + content, truncated to `limit` chars. Head parts win the
 * budget (they carry the most signal per token); content fills the rest.
 */
export function composeEmbedText(
  bookmark: { title: string | null; description: string | null; content: string | null },
  limit = EMBED_TEXT_CHAR_LIMIT,
): string {
  const head = [bookmark.title, bookmark.description]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
  const content = bookmark.content?.trim() ?? '';
  if (!head) {
    return content.slice(0, limit);
  }
  if (!content) {
    return head.slice(0, limit);
  }
  const budget = limit - head.length - 2;
  return budget > 0 ? `${head}\n\n${content.slice(0, budget)}` : head.slice(0, limit);
}

export type ScrapeOutcome = 'scraped' | 'unchanged' | 'missing';

/**
 * Scrapes one bookmark and persists content/metadata/hash/scraped_at. Shared by
 * the job loop and the manual scrape endpoint. An unchanged page refreshes
 * `scraped_at` only, so reconciliation stops re-enqueuing it and downstream
 * jobs are skipped.
 */
export async function scrapeAndStore(deps: JobDeps, bookmarkId: string): Promise<ScrapeOutcome> {
  const bookmark = getBookmarkById(deps.db, bookmarkId);
  if (!bookmark) {
    return 'missing';
  }

  let result: ScrapeResult;
  try {
    result = await deps.scrape(bookmark.url);
  } catch (error) {
    // Only a definitive dead link (404/410) counts toward invalidation; every
    // other failure is transient and is retried on the next reconciliation
    // (ARCHITECTURE §10 scrape implementation).
    const statusCode = error instanceof ScrapeError ? error.statusCode : undefined;
    const deadLink = statusCode === 404 || statusCode === 410;
    const lastError = {
      at: Date.now(),
      status: statusCode ?? null,
      message: error instanceof Error ? error.message : String(error),
    };
    const metadata = {
      ...bookmark.metadata,
      scrape: { ...(bookmark.metadata?.scrape as object | undefined), lastError },
    };
    if (deadLink) {
      const attempts = bookmark.scrapeAttempts + 1;
      updateBookmark(deps.db, bookmarkId, {
        metadata,
        scrapeAttempts: attempts,
        status: attempts >= deps.config.scrape.maxAttempts ? 'invalid' : bookmark.status,
      });
    } else {
      updateBookmark(deps.db, bookmarkId, { metadata });
    }
    throw error;
  }

  if (result.contentHash === bookmark.contentHash) {
    updateBookmark(deps.db, bookmarkId, {
      metadata: { ...bookmark.metadata, scrape: { ...result.metadata.scrape } },
      scrapedAt: Date.now(),
      scrapeAttempts: 0,
      status: 'active',
    });
    return 'unchanged';
  }
  updateBookmark(deps.db, bookmarkId, {
    content: result.content,
    metadata: { ...bookmark.metadata, ...result.metadata },
    contentHash: result.contentHash,
    scrapedAt: Date.now(),
    scrapeAttempts: 0,
    status: 'active',
  });
  deps.queue?.enqueue(bookmarkId, 'embed');
  deps.queue?.enqueue(bookmarkId, 'screenshot');
  return 'scraped';
}

export type EmbedOutcome = 'embedded' | 'skipped' | 'missing';

/**
 * Chunk size for batched embedding requests. Conservative: a model-change
 * re-embed of N bookmarks costs ceil(N/16) HTTP round-trips instead of N, while
 * a single chunk failure never invalidates more than 16 bookmarks' worth of work.
 */
export const EMBED_BATCH_SIZE = 16;

export interface EmbedBatchEntry {
  bookmarkId: string;
  outcome: EmbedOutcome | 'failed';
  /** Populated when `outcome` is `failed`; the original error for logging/retry. */
  error?: unknown;
}

/**
 * Embeds a batch of bookmarks in chunks of `EMBED_BATCH_SIZE`, preserving
 * per-bookmark outcomes. Each bookmark is independent: a missing/skipped row
 * never enters a request, and a chunk-level request failure or a single write
 * failure marks only the affected bookmarks `failed`. Writes keep the §6 order
 * (SQLite canonical first, serving index after) on a per-bookmark basis, so a
 * vector write failure leaves the durable row present and the job retryable.
 */
export async function embedBookmarks(
  deps: JobDeps,
  bookmarkIds: string[],
): Promise<EmbedBatchEntry[]> {
  const { db, vector, embeddings } = deps;
  if (!embeddings) {
    return bookmarkIds.map((bookmarkId) => ({ bookmarkId, outcome: 'skipped' }));
  }

  const entries: EmbedBatchEntry[] = [];
  const pending: Array<{ bookmark: BookmarkWithTags; text: string }> = [];
  const wanted = new Set(bookmarkIds);
  for (const bookmark of getBookmarksWithTagsByIds(db, bookmarkIds)) {
    wanted.delete(bookmark.id);
    const text = composeEmbedText(bookmark);
    if (text) {
      pending.push({ bookmark, text });
    } else {
      entries.push({ bookmarkId: bookmark.id, outcome: 'skipped' });
    }
  }
  // Any requested id the lookup did not return no longer exists.
  for (const bookmarkId of bookmarkIds) {
    if (wanted.has(bookmarkId)) {
      entries.push({ bookmarkId, outcome: 'missing' });
    }
  }

  // The configured EMBEDDING_MODEL is the row's identity (ARCHITECTURE §6/§8,
  // M4): rows are keyed by the pinned model, which is what reconciliation
  // compares against. The client's response model is provider-normalized and
  // may differ cosmetically (e.g. `text-embedding-3-small` vs
  // `openai/text-embedding-3-small`); storing it would flag every row as stale
  // on every startup and re-embed forever.
  const model = deps.config.embeddings.model ?? 'unknown';

  for (let offset = 0; offset < pending.length; offset += EMBED_BATCH_SIZE) {
    const chunk = pending.slice(offset, offset + EMBED_BATCH_SIZE);
    let vectors: Float32Array[];
    let dims: number;
    try {
      const result = await embeddings.embed(chunk.map((item) => item.text));
      vectors = result.vectors;
      dims = result.dims;
    } catch (error) {
      // The request failed as a unit; each bookmark keeps an independent retry.
      for (const item of chunk) {
        entries.push({ bookmarkId: item.bookmark.id, outcome: 'failed', error });
      }
      continue;
    }

    for (let i = 0; i < chunk.length; i += 1) {
      const item = chunk[i]!;
      const vectorValue = vectors[i];
      if (!vectorValue) {
        entries.push({ bookmarkId: item.bookmark.id, outcome: 'skipped' });
        continue;
      }
      try {
        // SQLite first (canonical), then the serving index (§6 write-through order).
        upsertEmbedding(db, {
          bookmarkId: item.bookmark.id,
          model,
          dims,
          embedding: packFloat32(vectorValue),
        });
        await vector.upsert({
          bookmarkId: item.bookmark.id,
          vector: vectorValue,
          payload: {
            model,
            dims,
            // The payload mirrors the bookmark's filterable state (shared
            // VectorPayload) so the vector engine can enforce category/tag
            // filters inside the top-k query. There is no dataset axis left
            // to filter by (MODEL.md principle 1).
            categoryId: item.bookmark.categoryId,
            tagIds: item.bookmark.tags.map((tag) => tag.tagId),
          },
        });
        entries.push({ bookmarkId: item.bookmark.id, outcome: 'embedded' });
      } catch (error) {
        entries.push({ bookmarkId: item.bookmark.id, outcome: 'failed', error });
      }
    }
  }

  return entries;
}

/**
 * Embeds one bookmark (title + description + content) and write-throughs the
 * vector into the index (Qdrant primary + warm KNN fallback). Skipped without
 * an embedding client or with nothing to embed — a normal degraded state, not
 * an error (ARCHITECTURE §6/§10). Delegates to `embedBookmarks` so the single
 * and batched paths share one write-through implementation.
 */
export async function embedBookmark(deps: JobDeps, bookmarkId: string): Promise<EmbedOutcome> {
  const [entry] = await embedBookmarks(deps, [bookmarkId]);
  if (!entry || entry.outcome === 'missing') {
    return 'missing';
  }
  if (entry.outcome === 'failed') {
    throw entry.error instanceof Error ? entry.error : new Error(String(entry.error));
  }
  return entry.outcome;
}

export type ScreenshotOutcome = 'captured' | 'failed' | 'skipped' | 'missing';

/**
 * Captures a screenshot (or falls back to `og:image`) and persists the bytes
 * to `<screenshotsDir>/<bookmarkId>.jpg`. Stores both the local path and the
 * discovered `og:image` URL under `metadata.image`. Failures are non-fatal:
 * the bookmark stays; reconciliation retries on the next start.
 */
export async function screenshotAndStore(
  deps: JobDeps,
  bookmarkId: string,
): Promise<ScreenshotOutcome> {
  const bookmark = getBookmarkById(deps.db, bookmarkId);
  if (!bookmark) {
    return 'missing';
  }
  if (!deps.screenshot) {
    return 'skipped';
  }
  if (!deps.screenshotsDir) {
    // Nowhere to persist the bytes — the app edge always injects the dir
    // (server env), so an absent dir means the job is disabled.
    return 'skipped';
  }

  const existing = parseBookmarkImage(bookmark.metadata);
  if (existing.screenshotPath && existing.ogImageUrl) {
    // Both visuals recorded — nothing to retry until metadata is cleared.
    return 'skipped';
  }

  let result: ScreenshotResult | null;
  try {
    result = await deps.screenshot.capture(bookmark.url);
  } catch (error) {
    console.warn(`[jobs] screenshot ${bookmarkId} capture threw`, error);
    return 'failed';
  }
  if (!result) {
    return 'failed';
  }

  const dir = deps.screenshotsDir;
  await mkdir(dir, { recursive: true });
  const filename = `${bookmarkId}.jpg`;
  const absolutePath = join(dir, filename);
  await writeFile(absolutePath, result.buffer);

  const ogImageUrl = result.ogImageUrl ?? existing.ogImageUrl ?? null;
  updateBookmark(deps.db, bookmarkId, {
    metadata: {
      ...bookmark.metadata,
      image: {
        ogImageUrl,
        screenshotPath: filename,
      },
    },
  });
  return 'captured';
}

/**
 * Starts the sequential worker. One job runs at a time; failures retry with
 * exponential backoff and are logged + dropped after `maxAttempts` (the manual
 * scrape endpoint or the next reconciliation re-enqueues).
 */
export function startJobQueue(options: JobQueueOptions): JobQueue {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  /**
   * Coarse job-progress hints (ARCHITECTURE §9): one on enqueue, one on
   * completion. Lossy by design — dropping one can only cost a refetch.
   */
  const emitJob = (bookmarkId: string, job: JobType): void =>
    options.events?.emit({ topic: 'jobs.changed', bookmarkId, job });

  /**
   * Row-change hint mirroring the manual HTTP endpoints (enrichment service):
   * emitted only when the job actually changed the bookmark row, so UIs that
   * do not track `jobs.changed` still converge during background enrichment.
   */
  const emitBookmark = (bookmarkId: string): void =>
    options.events?.emit({ topic: 'bookmarks.changed', bookmarkIds: [bookmarkId] });

  const queue: JobQueue = {
    enqueue() {},
    pendingCount() {
      return 0;
    },
    async waitForIdle() {},
    stop() {},
  };
  const deps: JobDeps = { ...options, queue };

  const handlers: Record<JobType, (bookmarkId: string) => Promise<void>> = {
    scrape: async (id) => {
      try {
        const outcome = await scrapeAndStore(deps, id);
        // 'unchanged' refreshes only scraped_at; 'missing' touches nothing.
        if (outcome === 'scraped') {
          emitBookmark(id);
        }
      } catch (error) {
        // A failed scrape still wrote `metadata.scrape.lastError`, so the UI
        // error surface needs the hint too (same family as the row-change
        // emits — a stale error badge is as invisible as stale content).
        emitBookmark(id);
        throw error;
      }
    },
    embed: async (id) => {
      const outcome = await embedBookmark(deps, id);
      if (outcome === 'embedded') {
        options.onEmbedded?.(id);
      }
    },
    classify: async (id) => {
      const outcome = await classifyBookmark(
        {
          db: deps.db,
          vector: deps.vector,
          classifier: options.classifier,
          config: options.config,
        },
        id,
      );
      if (outcome.assigned > 0 || outcome.retracted > 0) {
        emitBookmark(id);
      }
    },
    screenshot: async (id) => {
      const outcome = await screenshotAndStore(deps, id);
      // Only a capture changes the row (`metadata.image`).
      if (outcome === 'captured') {
        emitBookmark(id);
      }
    },
  };

  const pending = new Map<string, JobType>();
  const order: string[] = [];
  let running = false;
  let stopped = false;
  const idleResolvers: Array<() => void> = [];

  function resolveIfDrained(): void {
    if (!running && order.length === 0) {
      for (const resolve of idleResolvers.splice(0)) {
        resolve();
      }
    }
  }

  async function runWithRetries(type: JobType, bookmarkId: string): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (stopped) {
        return;
      }
      try {
        await handlers[type](bookmarkId);
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          console.warn(`[jobs] ${type} ${bookmarkId} failed after ${attempt} attempts`, error);
          return;
        }
        await Bun.sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  /**
   * Pulls up to `EMBED_BATCH_SIZE` pending embed jobs (including `seedId`) out
   * of the queue so one HTTP round-trip covers many re-embeds. Other job types
   * stay in place — embed is independent of scrape/screenshot.
   */
  function collectEmbedBatch(seedId: string): string[] {
    const ids = [seedId];
    while (ids.length < EMBED_BATCH_SIZE) {
      const index = order.findIndex((key) => pending.get(key) === 'embed');
      if (index === -1) {
        break;
      }
      const [nextKey] = order.splice(index, 1);
      if (!nextKey) {
        break;
      }
      pending.delete(nextKey);
      ids.push(nextKey.slice('embed:'.length));
    }
    return ids;
  }

  /**
   * Batched embed handling with the same retry/cooldown contract as
   * `runWithRetries`, but per bookmark: only rows whose write failed are retried,
   * and each successful embed fires `onEmbedded` exactly once.
   */
  async function runEmbedBatch(ids: string[]): Promise<void> {
    let remaining = ids;
    for (let attempt = 1; remaining.length > 0; attempt += 1) {
      if (stopped) {
        return;
      }
      const results = await embedBookmarks(deps, remaining);
      const failed: string[] = [];
      for (const entry of results) {
        if (entry.outcome === 'embedded') {
          options.onEmbedded?.(entry.bookmarkId);
          emitJob(entry.bookmarkId, 'embed');
        } else if (entry.outcome === 'failed') {
          failed.push(entry.bookmarkId);
        }
      }
      remaining = failed;
      if (remaining.length === 0 || attempt === maxAttempts) {
        break;
      }
      await Bun.sleep(baseDelayMs * 2 ** (attempt - 1));
    }
    if (remaining.length > 0) {
      console.warn(
        `[jobs] embed failed after ${maxAttempts} attempts for ${remaining.length} bookmark(s)`,
      );
    }
  }

  async function pump(): Promise<void> {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      // `stopped` is flipped by queue.stop() while a job is still awaiting, so
      // the condition legitimately changes between iterations.
      // oxlint-disable-next-line no-unmodified-loop-condition
      while (!stopped) {
        const key = order.shift();
        if (!key) {
          break;
        }
        const type = pending.get(key);
        pending.delete(key);
        if (!type) {
          continue;
        }
        if (type === 'embed') {
          await runEmbedBatch(collectEmbedBatch(key.slice('embed:'.length)));
        } else {
          const bookmarkId = key.slice(type.length + 1);
          await runWithRetries(type, bookmarkId);
          emitJob(bookmarkId, type);
        }
      }
    } finally {
      running = false;
      resolveIfDrained();
    }
  }

  queue.enqueue = (bookmarkId, type) => {
    if (stopped) {
      return;
    }
    const key = `${type}:${bookmarkId}`;
    if (pending.has(key)) {
      return; // already queued; a running job can be re-enqueued for later
    }
    pending.set(key, type);
    order.push(key);
    emitJob(bookmarkId, type);
    // Deferred to a microtask so synchronous bursts (e.g. an import loop) dedupe
    // before the first job is dequeued.
    queueMicrotask(() => void pump());
  };

  queue.pendingCount = () => order.length;

  queue.waitForIdle = () => {
    if (!running && order.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      idleResolvers.push(resolve);
    });
  };

  queue.stop = () => {
    stopped = true;
    order.length = 0;
    pending.clear();
    resolveIfDrained();
  };

  return queue;
}

export interface ReconcileReport {
  scrape: number;
  embed: number;
  reembed: number;
  screenshot: number;
}

/**
 * Startup reconciliation (ARCHITECTURE §10): re-enqueue scrape for never-scraped
 * bookmarks, embed for scraped-but-unembedded bookmarks, and re-embed rows whose
 * stored model differs from the configured one (model changes require a full
 * re-embed pass, §6). The screenshot job enqueues for bookmarks without a
 * screenshot AND without an `og:image` reference (the placeholder fallback).
 */
export function reconcileEnrichment(
  queue: JobQueue,
  db: Database,
  embeddingsModel?: string,
  hasScreenshotClient = true,
): ReconcileReport {
  const report: ReconcileReport = { scrape: 0, embed: 0, reembed: 0, screenshot: 0 };
  for (const id of listBookmarkIdsMissingContent(db)) {
    queue.enqueue(id, 'scrape');
    report.scrape += 1;
  }
  if (embeddingsModel) {
    for (const id of listBookmarkIdsMissingEmbeddings(db)) {
      queue.enqueue(id, 'embed');
      report.embed += 1;
    }
    for (const id of listEmbeddingModelMismatches(db, embeddingsModel)) {
      queue.enqueue(id, 'embed');
      report.reembed += 1;
    }
  }
  if (hasScreenshotClient) {
    for (const id of listBookmarkIdsMissingScreenshot(db)) {
      queue.enqueue(id, 'screenshot');
      report.screenshot += 1;
    }
  }
  return report;
}
