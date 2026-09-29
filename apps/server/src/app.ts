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
import { importMarkdown, parseCollection } from '@al-yo-bo/importer';
import { fuseSearch } from '@al-yo-bo/search';
import {
  clampPagination,
  isHttpUrl,
  type BookmarkSort,
  type BookmarkWithTags,
  type RankedCandidate,
  type SearchMode,
  type SearchResponse,
  type TagStatus,
} from '@al-yo-bo/shared';

import type { ServerConfig } from './env.ts';
import { AppError, NotFoundError, ValidationError } from './errors.ts';

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

function searchResponse(
  db: Database,
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
): SearchResponse {
  const { limit, offset } = clampPagination(input.limit, input.offset);

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

  const keyword = keywordSearch(db, {
    q: input.q,
    categoryId: input.categoryId,
    tagId: input.tagId,
    limit,
    offset,
  });
  const semantic: RankedCandidate[] = [];
  const fused = fuseSearch(keyword, semantic, input.mode);
  const items = getBookmarksWithTagsByIds(
    db,
    fused.map((candidate) => candidate.bookmarkId),
  );
  const total = countKeywordMatches(db, {
    q: input.q,
    categoryId: input.categoryId,
    tagId: input.tagId,
  });

  return {
    items,
    total,
    mode: semantic.length > 0 ? input.mode : 'keyword',
    pagination: { limit, offset, hasMore: offset + items.length < total },
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

// All API routes are chained on one Hono instance so `ReturnType<typeof createApp>`
// produces usable Hono RPC types for apps/web.
export function createApp(db: Database, config: ServerConfig) {
  const app = new Hono()
    .get('/api/health', (c) => c.json({ status: 'ok', version: '0.0.0' } as const))

    .get('/api/bookmarks', (c) =>
      c.json(
        searchResponse(db, {
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
      return c.json(bookmarkView(db, bookmark.id), 201);
    })

    .get('/api/bookmarks/:id', (c) => c.json(bookmarkView(db, c.req.param('id'))))

    .patch('/api/bookmarks/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
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
      const updated = updateBookmark(db, c.req.param('id'), patch);
      if (!updated) {
        throw new NotFoundError('Bookmark not found');
      }
      return c.json(bookmarkView(db, updated.id));
    })

    .delete('/api/bookmarks/:id', (c) => {
      if (!deleteBookmark(db, c.req.param('id'))) {
        throw new NotFoundError('Bookmark not found');
      }
      return c.body(null, 204);
    })

    .post('/api/bookmarks/:id/tags', jsonBody, (c) => {
      const bookmarkId = c.req.param('id');
      const tagId = requiredString(c.req.valid('json'), 'tagId');
      if (!getBookmarkById(db, bookmarkId)) {
        throw new NotFoundError('Bookmark not found');
      }
      if (!getTagById(db, tagId)) {
        throw new NotFoundError('Tag not found');
      }
      assignTag(db, { bookmarkId, tagId, source: 'user' });
      return c.json(bookmarkView(db, bookmarkId));
    })

    .delete('/api/bookmarks/:id/tags/:tagId', (c) => {
      if (!removeBookmarkTag(db, c.req.param('id'), c.req.param('tagId'))) {
        throw new NotFoundError('Assignment not found');
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
      const updated = updateCategory(db, c.req.param('id'), {
        name: 'name' in body ? requiredString(body, 'name') : undefined,
        description: 'description' in body ? optionalString(body, 'description') : undefined,
      });
      if (!updated) {
        throw new NotFoundError('Category not found');
      }
      return c.json(updated);
    })

    .delete('/api/categories/:id', (c) => {
      if (!deleteCategory(db, c.req.param('id'))) {
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
      const updated = updateTag(db, c.req.param('id'), {
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
      const updated = setTagStatus(db, c.req.param('id'), status);
      if (!updated) {
        throw new NotFoundError('Tag not found');
      }
      return c.json(updated);
    })

    .delete('/api/tags/:id', (c) => {
      if (!deleteTag(db, c.req.param('id'))) {
        throw new NotFoundError('Tag not found');
      }
      return c.body(null, 204);
    })

    .get('/api/aggregates', (c) => c.json(getAggregates(db)))

    .get('/api/review/proposed-tags', (c) => c.json(listProposedTags(db)))

    .get('/api/review/candidates', (c) =>
      c.json(listBelowThresholdCandidates(db, config.autoAssignThreshold)),
    )

    .post('/api/review/candidates/accept', jsonBody, (c) => {
      const body = c.req.valid('json');
      const bookmarkId = requiredString(body, 'bookmarkId');
      const tagId = requiredString(body, 'tagId');
      assignTag(db, { bookmarkId, tagId, source: 'user' });
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
