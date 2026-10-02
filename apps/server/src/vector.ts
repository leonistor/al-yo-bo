import type { Database } from 'bun:sqlite';

import { getBookmarksWithTagsByIds, listEmbeddings } from '@al-yo-bo/db';
import { FallbackVectorIndex, KnnIndex, type FallbackPayload } from '@al-yo-bo/search';
import type { VectorIndex } from '@al-yo-bo/shared';
import { QdrantIndex, type SyncPayload, type SyncReport } from '@al-yo-bo/vectordb';

import type { ServerConfig } from './env.ts';

/**
 * Qdrant boot-sync retry policy. `bun run dev` starts the sidecar in parallel
 * with the server, so the first sync can race the sidecar binding :6333.
 * 5 attempts × 1.25s ≈ 6s worst case before degrading to the in-memory index.
 */
const QDRANT_BOOT_SYNC_ATTEMPTS = 5;
const QDRANT_BOOT_SYNC_DELAY_MS = 1_250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded retry around the boot sync — startup recovery for the dev start
 * race, not a general-purpose backoff. Re-throws the last error after the
 * final attempt so the caller's existing degradation path handles it.
 */
async function bootSyncWithRetry(sync: () => Promise<SyncReport>): Promise<SyncReport> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= QDRANT_BOOT_SYNC_ATTEMPTS; attempt++) {
    try {
      return await sync();
    } catch (error) {
      lastError = error;
      if (attempt < QDRANT_BOOT_SYNC_ATTEMPTS) {
        console.warn(
          `[vector] Qdrant not ready (attempt ${attempt}/${QDRANT_BOOT_SYNC_ATTEMPTS}); retrying in ${QDRANT_BOOT_SYNC_DELAY_MS}ms`,
        );
        await sleep(QDRANT_BOOT_SYNC_DELAY_MS);
      }
    }
  }
  throw lastError;
}

export interface VectorSearch {
  index: VectorIndex;
  backend: 'qdrant' | 'memory';
}

/** One bookmark's filterable state, read from SQLite (canonical payload source). */
function payloadOfBookmark(bookmark: {
  datasetId: string;
  categoryId: string | null;
  tags: Array<{ tagId: string }>;
}): SyncPayload & FallbackPayload {
  return {
    datasetId: bookmark.datasetId,
    categoryId: bookmark.categoryId,
    tagIds: bookmark.tags.map((tag) => tag.tagId),
  };
}

function resolvePayload(db: Database): (bookmarkId: string) => SyncPayload {
  return (bookmarkId) => {
    const [bookmark] = getBookmarksWithTagsByIds(db, [bookmarkId]);
    // A missing bookmark row cannot happen while its embedding row exists (FK
    // cascade); the empty-dataset fallback simply matches no filter.
    return bookmark
      ? payloadOfBookmark(bookmark)
      : { datasetId: '', categoryId: null, tagIds: [] };
  };
}

function resolvePayloads(db: Database): (bookmarkIds: string[]) => Map<string, FallbackPayload> {
  return (bookmarkIds) => {
    const map = new Map<string, FallbackPayload>();
    if (bookmarkIds.length === 0) {
      return map;
    }
    for (const bookmark of getBookmarksWithTagsByIds(db, bookmarkIds)) {
      map.set(bookmark.id, payloadOfBookmark(bookmark));
    }
    return map;
  };
}

/**
 * Boots the vector-serving stack (ARCHITECTURE §6):
 *
 * 1. `KnnIndex` always loads from SQLite — it is the offline fallback, so it
 *    must be warm even when Qdrant is healthy.
 * 2. When a Qdrant URL is configured, `sync` replays the SQLite rows into the
 *    collection (Qdrant is a rebuildable serving index; SQLite is canonical)
 *    and the index is wrapped in `FallbackVectorIndex` for runtime degradation.
 * 3. If Qdrant is unreachable at boot, `sync` is retried briefly (the sidecar
 *    may still be starting — `bun run dev` launches it in parallel); after the
 *    retries are exhausted, the in-memory index serves alone until the next
 *    server start or `reindex` call.
 *
 * Also used by the `reindex` endpoint to rebuild a fresh serving stack from
 * SQLite (the durable copy) and hot-swap it into the running server.
 */
export async function initVectorIndex(db: Database, config: ServerConfig): Promise<VectorSearch> {
  const records = listEmbeddings(db);
  const knn = new KnnIndex();
  try {
    knn.load(records);
  } catch (error) {
    // Mixed dimensions can only come from an interrupted model change; start
    // keyword-only and let startup reconciliation re-embed the stale rows.
    console.warn(
      '[vector] embedding matrix failed to load; semantic search is off until re-embedding finishes',
      error,
    );
  }

  const url = config.qdrant.url;
  if (!url) {
    return { index: knn, backend: 'memory' };
  }

  const qdrant = new QdrantIndex({
    url,
    collection: config.qdrant.collection,
    apiKey: config.qdrant.apiKey,
    timeoutMs: config.qdrant.timeoutMs,
  });

  try {
    const report = await bootSyncWithRetry(() => qdrant.sync(records, resolvePayload(db)));
    const summary = report.skipped
      ? 'in sync'
      : `upserted ${report.upserted}, deleted ${report.deleted}${report.recreated ? ', collection recreated' : ''}`;
    console.log(`[vector] Qdrant collection "${config.qdrant.collection}" ${summary}`);
    return {
      index: new FallbackVectorIndex(qdrant, knn, { resolvePayloads: resolvePayloads(db) }),
      backend: 'qdrant',
    };
  } catch (error) {
    console.warn(`[vector] Qdrant unavailable at ${url}; serving semantic search from the in-memory index`, error);
    return { index: knn, backend: 'memory' };
  }
}
