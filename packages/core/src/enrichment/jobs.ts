/**
 * In-process job loop (ARCHITECTURE §8, MVP decision): sequential, idempotent
 * jobs with bounded retries, deduplicated per (bookmark, type). The queue is
 * deliberately in-memory — SQLite holds the durable state that defines what
 * still needs doing, so `reconcileEnrichment` at startup recovers anything a
 * restart dropped.
 *
 * Job types:
 * - `scrape`    — page → content/metadata/content_hash
 * - `embed`     — content → vector (OpenRouter + SQLite BLOB)
 * - `classify`  — content → tag assignments via Ollaya
 * - `screenshot` — page → image bytes written to `data/screenshots/<uuid>.jpg`
 *
 * The screenshot job (2026-10-01 import simplification) is independent of
 * scrape: it fetches the page itself via the injected `ScreenshotClient`,
 * stores the buffer under `data/screenshots/`, and records both the local
 * path and the discovered `og:image` URL on `metadata.image`. A failed
 * screenshot never invalidates the bookmark — reconciliation retries on the
 * next start.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Database } from 'bun:sqlite';

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
import type { EmbeddingClient } from '@al-yo-bo/embeddings';
import { packFloat32, type VectorIndex } from '@al-yo-bo/shared';

import { ScrapeError, type ScrapeFn, type ScrapeResult } from '../scrape.ts';
import type { ScreenshotClient, ScreenshotResult } from '../screenshot.ts';
import type { CoreConfig } from '../config.ts';
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
   * Absolute path the screenshot job writes image bytes to. Created on demand.
   * Defaults to `<cwd>/data/screenshots/`.
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
  /** Called after a successful embed write — the classification trigger (§6). */
  onEmbedded?: (bookmarkId: string) => void;
  /** Classification subsystem; absent = classification stays off (§1.5). */
  classifier?: ClassifyDeps['classifier'];
  /** Core configuration (threshold, Ollaya model) for the classify job. */
  config: CoreConfig;
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
    // other failure is transient and is retried on the next reconciliation.
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
 * Embeds one bookmark (title + description + content) and write-throughs the
 * vector into the index (Qdrant primary + warm KNN fallback). Skipped without
 * an embedding client or with nothing to embed — a normal degraded state, not
 * an error (ARCHITECTURE §6/§10).
 */
export async function embedBookmark(deps: JobDeps, bookmarkId: string): Promise<EmbedOutcome> {
  const { db, vector, embeddings } = deps;
  if (!embeddings) {
    return 'skipped';
  }
  const [bookmark] = getBookmarksWithTagsByIds(db, [bookmarkId]);
  if (!bookmark) {
    return 'missing';
  }
  const text = composeEmbedText(bookmark);
  if (!text) {
    return 'skipped';
  }

  // The configured EMBEDDING_MODEL is the row's identity (ARCHITECTURE §6: rows
  // are keyed by the pinned model, which is what reconciliation compares against).
  // The client's response model is provider-normalized and may differ cosmetically
  // (e.g. `text-embedding-3-small` vs `openai/text-embedding-3-small`); storing it
  // would flag every row as stale on every startup and re-embed forever.
  const { vectors, dims } = await embeddings.embed([text]);
  const vectorValue = vectors[0];
  if (!vectorValue) {
    return 'skipped';
  }
  const model = deps.config.embeddings.model ?? 'unknown';

  // SQLite first (canonical), then the serving index (§6 write-through order).
  upsertEmbedding(db, { bookmarkId, model, dims, embedding: packFloat32(vectorValue) });
  await vector.upsert({
    bookmarkId,
    vector: vectorValue,
    payload: {
      model,
      dims,
      categoryId: bookmark.categoryId,
      tagIds: bookmark.tags.map((tag) => tag.tagId),
    },
  });
  return 'embedded';
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

  const dir = deps.screenshotsDir ?? join(process.cwd(), 'data', 'screenshots');
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
      await scrapeAndStore(deps, id);
    },
    embed: async (id) => {
      const outcome = await embedBookmark(deps, id);
      if (outcome === 'embedded') {
        options.onEmbedded?.(id);
      }
    },
    classify: async (id) => {
      await classifyBookmark(
        {
          db: deps.db,
          vector: deps.vector,
          classifier: options.classifier,
          config: options.config,
        },
        id,
      );
    },
    screenshot: async (id) => {
      await screenshotAndStore(deps, id);
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

  async function pump(): Promise<void> {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
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
        await runWithRetries(type, key.slice(type.length + 1));
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
 * Startup reconciliation (ARCHITECTURE §8): re-enqueue scrape for never-scraped
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
