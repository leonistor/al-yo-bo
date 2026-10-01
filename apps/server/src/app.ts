import type { Database } from 'bun:sqlite';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';

import {
  assignTag,
  countKeywordMatches,
  createBookmark,
  createCategory,
  createTag,
  deleteBookmark,
  deleteCategory,
  deleteTag,
  getAggregates,
  getBookmarkById,
  getBookmarksWithTagsByIds,
  getTagById,
  keywordSearch,
  listBelowThresholdCandidates,
  listBookmarkIdsForCategoryScope,
  listBookmarks,
  listCategories,
  listProposedTags,
  listTags,
  removeBookmarkTag,
  setTagStatus,
  updateBookmark,
  updateCategory,
  updateTag,
  type BookmarkInput,
} from '@al-yo-bo/db';
import type { ClassifierClient } from '@al-yo-bo/classifier';
import type { EmbeddingClient } from '@al-yo-bo/embeddings';
import { importMarkdown, parseCollection } from '@al-yo-bo/importer';
import { fuseSearch } from '@al-yo-bo/search';
import {
  clampPagination,
  isHttpUrl,
  isUuid,
  type BookmarkSort,
  type BookmarkWithTags,
  type RankedCandidate,
  type SearchMode,
  type SearchResponse,
  type TagStatus,
  type VectorIndex,
} from '@al-yo-bo/shared';

import type { ServerConfig } from './env.ts';
import { AppError, NotFoundError, ValidationError } from './errors.ts';
import { classifyBookmark } from './classify.ts';
import { scrapeAndStore, type JobQueue, type JobType } from './jobs.ts';
import { ScrapeError, type ScrapeFn } from './scrape.ts';

/** Subsystems optional to request handling; absent entries degrade gracefully. */
export interface AppServices {
  vector: VectorIndex;
  /** Which implementation serves `vector` (reporting only, e.g. /api/health). */
  vectorBackend?: 'qdrant' | 'memory';
  embeddings?: EmbeddingClient;
  /** Enrichment queue; absent when running without the worker (e.g. some tests). */
  jobs?: JobQueue;
  /** Manual scrape capability; absent when the scraper is not configured. */
  scrape?: ScrapeFn;
  /** Classification client; absent = classification endpoints report unavailable. */
  classifier?: ClassifierClient;
}

// Declaring the JSON shape as a validator is what lets Hono RPC infer the request
// body type for `apps/web` (`c.req.valid('json')`).
const jsonBody = validator('json', (value, c) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return c.json(
      {
        type: 'https://al-yo-bo.local/problems/validation',
        title: 'Request body must be a JSON object',
        status: 400,
      },
      400,
    );
  }
  return value as Record<string, unknown>;
});

function parseMode(value: string | undefined): SearchMode {
  return value === 'semantic' || value === 'hybrid' ? value : 'keyword';
}

function parseSort(value: string | undefined): BookmarkSort {
  return value === 'title' || value === 'updated_at' ? value : 'created_at';
}

function parseDirection(value: string | undefined): 'asc' | 'desc' {
  return value === 'asc' ? 'asc' : 'desc';
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`"${field}" is required`);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function optionalId(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`"${field}" must be a string`);
  }
  return value;
}

function bookmarkView(db: Database, id: string): BookmarkWithTags {
  const [view] = getBookmarksWithTagsByIds(db, [id]);
  if (!view) {
    throw new NotFoundError('Bookmark not found');
  }
  return view;
}

/**
 * Validates an `:id` path parameter before it reaches SQL: non-UUID strings
 * would otherwise throw deep inside `uuidToBytes` and surface as a 500.
 */
function pathId(c: Context, message: string): string {
  const id = c.req.param('id') ?? '';
  if (!isUuid(id)) {
    throw new NotFoundError(message);
  }
  return id;
}

/**
 * Semantic candidate list for the search query. Requires the whole chain to be
 * available (vector index with vectors, embedding client, configured model);
 * any missing link or failure returns an empty list, which degrades the search
 * to keyword-only — a normal state, never an error (ARCHITECTURE §6).
 */
async function semanticCandidates(
  services: AppServices | undefined,
  config: ServerConfig,
  input: {
    q: string;
    mode: SearchMode;
    categoryId?: string;
    tagId?: string;
    limit: number;
    offset: number;
  },
): Promise<RankedCandidate[]> {
  if (input.mode === 'keyword') {
    return [];
  }
  const { vector, embeddings } = services ?? {};
  const model = config.embeddings.model;
  if (!vector || !embeddings || !model || vector.size === 0) {
    return [];
  }
  try {
    const [queryVector] = (await embeddings.embed([input.q])).vectors;
    if (!queryVector) {
      return [];
    }
    // Category/tag filters are pushed into the vector query (server-side on
    // Qdrant, client-side overfetch on the in-memory fallback).
    return await vector.search(queryVector, input.offset + input.limit, {
      categoryId: input.categoryId,
      tagId: input.tagId,
    });
  } catch (error) {
    console.warn('semantic search unavailable; returning keyword-only results', error);
    return [];
  }
}

/** Mirrors a tag/category change into the vector index payload (best-effort). */
async function syncVectorPayload(
  services: AppServices,
  db: Database,
  bookmarkId: string,
): Promise<void> {
  if (services.vector.size === 0) {
    return;
  }
  const [bookmark] = getBookmarksWithTagsByIds(db, [bookmarkId]);
  if (!bookmark) {
    await services.vector.delete(bookmarkId);
    return;
  }
  await services.vector.updatePayload(bookmarkId, {
    categoryId: bookmark.categoryId,
    tagIds: bookmark.tags.map((tag) => tag.tagId),
  });
}

async function searchResponse(
  db: Database,
  services: AppServices | undefined,
  config: ServerConfig,
  input: {
    q: string;
    mode: SearchMode;
    categoryId?: string;
    tagId?: string;
    sort: BookmarkSort;
    direction: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  },
): Promise<SearchResponse> {  const { limit, offset } = clampPagination(input.limit, input.offset);

  if (!input.q) {
    const { items, total } = listBookmarks(db, {
      categoryId: input.categoryId,
      tagId: input.tagId,
      sort: input.sort,
      direction: input.direction,
      limit,
      offset,
    });
    return {
      items,
      total,
      mode: 'keyword',
      pagination: { limit, offset, hasMore: offset + items.length < total },
    };
  }

  const keywordTotal = countKeywordMatches(db, {
    q: input.q,
    categoryId: input.categoryId,
    tagId: input.tagId,
  });

  // Fused modes fetch candidates from rank 0 over the whole page window, plus one
  // probe item past it so `hasMore` is observable; keyword-only pages in SQL.
  const window = offset + limit;
  const semantic =
    input.mode === 'keyword'
      ? []
      : await semanticCandidates(services, config, {
          q: input.q,
          mode: input.mode,
          categoryId: input.categoryId,
          tagId: input.tagId,
          limit: window + 1,
          offset: 0,
        });
  const fusedMode = semantic.length > 0;

  const keyword = keywordSearch(db, {
    q: input.q,
    categoryId: input.categoryId,
    tagId: input.tagId,
    // In fused modes both ranked lists must cover the same window, otherwise
    // page slices of the fused ranking would repeat or skip items across pages.
    limit: fusedMode ? window + 1 : limit,
    offset: fusedMode ? 0 : offset,
  });

  const fused = fuseSearch(keyword, semantic, input.mode);
  const mode: SearchMode = fusedMode ? input.mode : 'keyword';

  if (!fusedMode) {
    const items = getBookmarksWithTagsByIds(
      db,
      keyword.map((candidate) => candidate.bookmarkId),
    );
    return {
      items,
      total: keywordTotal,
      mode,
      pagination: { limit, offset, hasMore: offset + items.length < keywordTotal },
    };
  }

  // Semantic contributed: pages are slices of the fused ranking over the fetched
  // window. Semantic top-k has no total, so `total` is a monotonic lower bound
  // ("at least this many results"): past pages stay counted, the probe item makes
  // `hasMore` exact, and a finished window reports exactly what was seen.
  const page = fused.slice(offset, window);
  const hasMore = fused.length > window;
  const items = getBookmarksWithTagsByIds(
    db,
    page.map((candidate) => candidate.bookmarkId),
  );

  return {
    items,
    total: hasMore
      ? Math.max(keywordTotal, window + 1)
      : Math.max(keywordTotal, offset + items.length),
    mode,
    pagination: { limit, offset, hasMore },
  };
}

async function readImportText(c: Context): Promise<string> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await c.req.json()) as Record<string, unknown>;
    const markdown = body.markdown;
    if (typeof markdown !== 'string') {
      throw new ValidationError('"markdown" is required');
    }
    return markdown;
  }
  return await c.req.text();
}

/** Fire-and-forget enrichment trigger; a missing queue (workerless mode) is a no-op. */
function enqueueJob(services: AppServices | undefined, bookmarkId: string, type: JobType): void {
  services?.jobs?.enqueue(bookmarkId, type);
}

/** Cached Ollaya reachability probe (health only; 30 s TTL, sub-second timeout). */
let ollayaProbe: { at: number; reachable: boolean } | null = null;

async function probeOllaya(config: ServerConfig): Promise<boolean> {
  if (ollayaProbe && Date.now() - ollayaProbe.at < 30_000) {
    return ollayaProbe.reachable;
  }
  let reachable = false;
  try {
    const response = await fetch(config.ollaya.baseUrl.replace(/\/$/, '') + '/', {
      signal: AbortSignal.timeout(750),
    });
    reachable = response.status < 500;
  } catch {
    reachable = false;
  }
  ollayaProbe = { at: Date.now(), reachable };
  return reachable;
}

// All API routes are chained on one Hono instance so `ReturnType<typeof createApp>`
// produces usable Hono RPC types for apps/web.
export function createApp(db: Database, config: ServerConfig, services?: AppServices) {
  const app = new Hono()
    .get('/api/health', async (c) =>
      c.json({
        status: 'ok' as const,
        version: '0.0.0' as const,
        vector: {
          backend: services?.vectorBackend ?? ('memory' as const),
          indexed: services?.vector.size ?? 0,
        },
        embeddings: {
          enabled: Boolean(services?.embeddings),
          model: config.embeddings.model ?? null,
        },
        enrichment: {
          scrapeAvailable: Boolean(services?.scrape),
          jobsPending: services?.jobs?.pendingCount() ?? 0,
        },
        classifier: {
          available: Boolean(services?.classifier),
          model: config.ollaya.model,
          reachable: services?.classifier ? await probeOllaya(config) : false,
        },
      }),
    )

    .get('/api/bookmarks', async (c) =>
      c.json(
        await searchResponse(db, services, config, {
          q: c.req.query('q')?.trim() ?? '',
          mode: parseMode(c.req.query('mode')),
          categoryId: c.req.query('categoryId') || undefined,
          tagId: c.req.query('tagId') || undefined,
          sort: parseSort(c.req.query('sort')),
          direction: parseDirection(c.req.query('direction')),
          limit: parseNumber(c.req.query('limit')),
          offset: parseNumber(c.req.query('offset')),
        }),
      ),
    )

    .post('/api/bookmarks', jsonBody, (c) => {
      const body = c.req.valid('json');
      const url = requiredString(body, 'url');
      if (!isHttpUrl(url)) {
        throw new ValidationError('Only HTTP(S) URLs can be saved');
      }
      const bookmark = createBookmark(db, {
        url,
        title: optionalString(body, 'title'),
        description: optionalString(body, 'description'),
        categoryId: optionalId(body, 'categoryId'),
      });
      enqueueJob(services, bookmark.id, 'scrape');
      return c.json(bookmarkView(db, bookmark.id), 201);
    })

    .get('/api/bookmarks/:id', (c) => c.json(bookmarkView(db, pathId(c, 'Bookmark not found'))))

    .patch('/api/bookmarks/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
      const id = pathId(c, 'Bookmark not found');
      const current = getBookmarkById(db, id);
      if (!current) {
        throw new NotFoundError('Bookmark not found');
      }
      const patch: Partial<BookmarkInput> = {};
      if ('url' in body) {
        patch.url = requiredString(body, 'url');
      }
      if ('title' in body) {
        patch.title = optionalString(body, 'title');
      }
      if ('description' in body) {
        patch.description = optionalString(body, 'description');
      }
      if ('categoryId' in body) {
        patch.categoryId = optionalId(body, 'categoryId');
      }
      const updated = updateBookmark(db, id, patch);
      if (!updated) {
        throw new NotFoundError('Bookmark not found');
      }
      // Content-bearing changes re-run the matching enrichment (§8 re-run triggers);
      // a category move only shifts the vector payload filters.
      if (updated.url !== current.url) {
        enqueueJob(services, id, 'scrape');
      } else if (updated.title !== current.title || updated.description !== current.description) {
        enqueueJob(services, id, 'embed');
      }
      if (services && updated.categoryId !== current.categoryId) {
        void syncVectorPayload(services, db, id);
      }
      return c.json(bookmarkView(db, id));
    })

    .post('/api/bookmarks/:id/scrape', async (c) => {
      const id = pathId(c, 'Bookmark not found');
      if (!getBookmarkById(db, id)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!services?.scrape) {
        throw new AppError('Scraping is not available', 503, 'scrape-unavailable');
      }
      try {
        const outcome = await scrapeAndStore(
          {
            db,
            vector: services.vector,
            embeddings: services.embeddings,
            scrape: services.scrape,
            config,
            // Chains the embed job into the same queue the worker drains.
            queue: services.jobs,
          },
          id,
        );
        return c.json({ status: outcome, bookmark: bookmarkView(db, id) });
      } catch (error) {
        if (error instanceof ScrapeError) {
          throw new AppError(error.message, 502, 'scrape-failed');
        }
        throw error;
      }
    })

    .post('/api/bookmarks/:id/classify', async (c) => {
      const id = pathId(c, 'Bookmark not found');
      if (!getBookmarkById(db, id)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!services?.classifier) {
        throw new AppError('Classification is not available', 503, 'classify-unavailable');
      }
      try {
        const outcome = await classifyBookmark(
          {
            db,
            vector: services.vector,
            classifier: services.classifier,
            config,
          },
          id,
        );
        return c.json({ ...outcome, bookmark: bookmarkView(db, id) });
      } catch (error) {
        throw new AppError(
          `Classification failed: ${error instanceof Error ? error.message : error}`,
          502,
          'classify-failed',
        );
      }
    })

    .delete('/api/bookmarks/:id', async (c) => {
      const id = pathId(c, 'Bookmark not found');
      if (!deleteBookmark(db, id)) {
        throw new NotFoundError('Bookmark not found');
      }
      // SQLite cascaded the embedding row; mirror the removal into the index.
      if (services && services.vector.size > 0) {
        await services.vector.delete(id);
      }
      return c.body(null, 204);
    })

    .post('/api/bookmarks/:id/tags', jsonBody, async (c) => {
      const bookmarkId = pathId(c, 'Bookmark not found');
      const tagId = requiredString(c.req.valid('json'), 'tagId');
      if (!getBookmarkById(db, bookmarkId)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!getTagById(db, tagId)) {
        throw new NotFoundError('Tag not found');
      }
      assignTag(db, { bookmarkId, tagId, source: 'user' });
      if (services) {
        await syncVectorPayload(services, db, bookmarkId);
      }
      return c.json(bookmarkView(db, bookmarkId));
    })

    .delete('/api/bookmarks/:id/tags/:tagId', async (c) => {
      const bookmarkId = pathId(c, 'Bookmark not found');
      const tagId = c.req.param('tagId');
      if (!isUuid(tagId) || !removeBookmarkTag(db, bookmarkId, tagId)) {
        throw new NotFoundError('Assignment not found');
      }
      if (services) {
        await syncVectorPayload(services, db, bookmarkId);
      }
      return c.body(null, 204);
    })

    .get('/api/categories', (c) => c.json(listCategories(db)))

    .post('/api/categories', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        createCategory(db, {
          name: requiredString(body, 'name'),
          description: optionalString(body, 'description'),
        }),
        201,
      );
    })

    .patch('/api/categories/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
      const updated = updateCategory(db, pathId(c, 'Category not found'), {
        name: 'name' in body ? requiredString(body, 'name') : undefined,
        description: 'description' in body ? optionalString(body, 'description') : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Category not found');
      }
      return c.json(updated);
    })

    .delete('/api/categories/:id', (c) => {
      if (!deleteCategory(db, pathId(c, 'Category not found'))) {
        throw new NotFoundError('Category not found');
      }
      return c.body(null, 204);
    })

    .get('/api/tags', (c) => c.json(listTags(db)))

    .post('/api/tags', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        createTag(db, {
          name: requiredString(body, 'name'),
          description: optionalString(body, 'description'),
          categoryId: optionalId(body, 'categoryId'),
        }),
        201,
      );
    })

    .patch('/api/tags/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
      const updated = updateTag(db, pathId(c, 'Tag not found'), {
        name: 'name' in body ? requiredString(body, 'name') : undefined,
        description: 'description' in body ? optionalString(body, 'description') : undefined,
        categoryId: 'categoryId' in body ? optionalId(body, 'categoryId') : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Tag not found');
      }
      return c.json(updated);
    })

    .post('/api/tags/:id/status', jsonBody, (c) => {
      const status = requiredString(c.req.valid('json'), 'status') as TagStatus;
      const previous = getTagById(db, pathId(c, 'Tag not found'));
      if (!previous) {
        throw new NotFoundError('Tag not found');
      }
      const updated = setTagStatus(db, previous.id, status);
      if (!updated) {
        throw new NotFoundError('Tag not found');
      }
      // Vocabulary change (§7 re-run triggers): activating a tag makes it a
      // candidate again -> re-classify the bookmarks in its scope.
      if (previous.status !== 'active' && status === 'active' && services?.jobs) {
        for (const id of listBookmarkIdsForCategoryScope(db, updated.categoryId)) {
          enqueueJob(services, id, 'classify');
        }
      }
      return c.json(updated);
    })

    .delete('/api/tags/:id', (c) => {
      if (!deleteTag(db, pathId(c, 'Tag not found'))) {
        throw new NotFoundError('Tag not found');
      }
      return c.body(null, 204);
    })

    .get('/api/aggregates', (c) => c.json(getAggregates(db)))

    .get('/api/review/proposed-tags', (c) => c.json(listProposedTags(db)))

    .get('/api/review/candidates', (c) =>
      c.json(listBelowThresholdCandidates(db, config.autoAssignThreshold)),
    )

    .post('/api/review/candidates/accept', jsonBody, async (c) => {
      const body = c.req.valid('json');
      const bookmarkId = requiredString(body, 'bookmarkId');
      const tagId = requiredString(body, 'tagId');
      assignTag(db, { bookmarkId, tagId, source: 'user' });
      if (services) {
        await syncVectorPayload(services, db, bookmarkId);
      }
      return c.json(bookmarkView(db, bookmarkId));
    })

    .post('/api/import/preview', async (c) => {
      const { bookmarks, skipped } = parseCollection(await readImportText(c));
      return c.json({ parsed: bookmarks.length, skipped, bookmarks });
    })

    .post('/api/import', async (c) => {
      const report = importMarkdown(db, await readImportText(c), {
        file: c.req.query('file') || undefined,
      });
      // New bookmarks enter the enrichment pipeline; updated ones keep theirs.
      for (const id of report.addedIds) {
        enqueueJob(services, id, 'scrape');
      }
      return c.json(report);
    });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        {
          type: `https://al-yo-bo.local/problems/${err.type}`,
          title: err.message,
          status: err.status,
        },
        err.status as ContentfulStatusCode,
      );
    }
    console.error(err);
    return c.json(
      { type: 'https://al-yo-bo.local/problems/internal', title: 'Internal error', status: 500 },
      500,
    );
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
