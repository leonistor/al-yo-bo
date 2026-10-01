import type { Database } from 'bun:sqlite';

import { getBookmarksWithTagsByIds, listEmbeddings } from '@al-yo-bo/db';
import { FallbackVectorIndex, KnnIndex, type FallbackPayload } from '@al-yo-bo/search';
import type { VectorIndex } from '@al-yo-bo/shared';
import { QdrantIndex, type SyncPayload } from '@al-yo-bo/vectordb';

import type { ServerConfig } from './env.ts';

export interface VectorSearch {
  index: VectorIndex;
  backend: 'qdrant' | 'memory';
}

/** One bookmark's filterable state, read from SQLite (canonical payload source). */
function payloadOfBookmark(bookmark: {
  categoryId: string | null;
  tags: Array<{ tagId: string }>;
}): SyncPayload & FallbackPayload {
  return {
    categoryId: bookmark.categoryId,
    tagIds: bookmark.tags.map((tag) => tag.tagId),
  };
}

function resolvePayload(db: Database): (bookmarkId: string) => SyncPayload {
  return (bookmarkId) => {
    const [bookmark] = getBookmarksWithTagsByIds(db, [bookmarkId]);
    return bookmark ? payloadOfBookmark(bookmark) : { categoryId: null, tagIds: [] };
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
 * 3. If Qdrant is unreachable at boot, the in-memory index serves alone until
 *    the next server start.
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
    const report = await qdrant.sync(records, resolvePayload(db));
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
