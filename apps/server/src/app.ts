import {
  DomainError,
  NotFoundError,
  ValidationError,
  type BookmarkPatch,
  type Core,
} from '@al-yo-bo/core';
import {
  isUuid,
  type BookmarkListStatus,
  type BookmarkSort,
  type SearchMode,
} from '@al-yo-bo/shared';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';

import { createChatHandler } from './chat.ts';
import type { ServerConfig } from './env.ts';
import { toProblemDetails } from './errors.ts';

/**
 * Transport adapter (ARCHITECTURE §4): parse/validate the HTTP request, call one
 * core service method, serialize the result. No route touches the database, the
 * vector index, or enrichment side effects — those live in `@al-yo-bo/core`, and
 * domain failures arrive here as `DomainError` for `toProblemDetails` to map.
 */

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

/** Invalid bookmarks stay out of default views; `invalid`/`all` must be explicit. */
function parseStatus(value: string | undefined): BookmarkListStatus {
  return value === 'invalid' || value === 'all' ? value : 'active';
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

/**
 * Validates an `:id` path parameter before it reaches core: non-UUID strings
 * would otherwise surface as a 500 from deep inside the UUID codec.
 */
function pathId(c: Context, message: string): string {
  const id = c.req.param('id') ?? '';
  if (!isUuid(id)) {
    throw new NotFoundError(message);
  }
  return id;
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
export function createApp(core: Core, config: ServerConfig) {
  const chatHandler = createChatHandler({
    config,
    search: (query, limit) => core.search.chatHits(query, limit),
  });

  const app = new Hono()
    .get('/api/health', async (c) => c.json(await core.health.health()))

    .get('/api/bookmarks', async (c) =>
      c.json(
        await core.search.search({
          q: c.req.query('q')?.trim() ?? '',
          mode: parseMode(c.req.query('mode')),
          categoryId: c.req.query('categoryId') || undefined,
          tagId: c.req.query('tagId') || undefined,
          status: parseStatus(c.req.query('status')),
          sort: parseSort(c.req.query('sort')),
          direction: parseDirection(c.req.query('direction')),
          limit: parseNumber(c.req.query('limit')),
          offset: parseNumber(c.req.query('offset')),
        }),
      ),
    )

    .post('/api/bookmarks', jsonBody, (c) => {
      const body = c.req.valid('json');
      const bookmark = core.bookmarks.create({
        url: requiredString(body, 'url'),
        title: optionalString(body, 'title'),
        description: optionalString(body, 'description'),
        categoryId: optionalId(body, 'categoryId'),
      });
      return c.json(bookmark, 201);
    })

    .get('/api/bookmarks/:id', (c) => c.json(core.bookmarks.get(pathId(c, 'Bookmark not found'))))

    .patch('/api/bookmarks/:id', jsonBody, async (c) => {
      const body = c.req.valid('json');
      const id = pathId(c, 'Bookmark not found');
      const patch: BookmarkPatch = {};
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
      return c.json(await core.bookmarks.update(id, patch));
    })

    .post('/api/bookmarks/:id/scrape', async (c) => {
      const id = pathId(c, 'Bookmark not found');
      return c.json(await core.enrichment.scrape(id));
    })

    .post('/api/bookmarks/:id/classify', async (c) => {
      const id = pathId(c, 'Bookmark not found');
      return c.json(await core.enrichment.classify(id));
    })

    .post('/api/bookmarks/:id/screenshot', async (c) => {
      const id = pathId(c, 'Bookmark not found');
      return c.json(await core.enrichment.screenshot(id));
    })

    .delete('/api/bookmarks/:id', async (c) => {
      await core.bookmarks.delete(pathId(c, 'Bookmark not found'));
      return c.body(null, 204);
    })

    .post('/api/bookmarks/:id/tags', jsonBody, async (c) => {
      const bookmarkId = pathId(c, 'Bookmark not found');
      const tagId = requiredString(c.req.valid('json'), 'tagId');
      return c.json(await core.bookmarks.assignTag(bookmarkId, tagId));
    })

    .delete('/api/bookmarks/:id/tags/:tagId', async (c) => {
      const bookmarkId = pathId(c, 'Bookmark not found');
      const tagId = c.req.param('tagId');
      await core.bookmarks.removeTag(bookmarkId, tagId);
      return c.body(null, 204);
    })

    .get('/api/categories', (c) => c.json(core.vocabulary.listCategories()))

    .post('/api/categories', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.createCategory({
          name: requiredString(body, 'name'),
          description: optionalString(body, 'description'),
          sectionId: optionalId(body, 'sectionId'),
        }),
        201,
      );
    })

    .patch('/api/categories/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.updateCategory(pathId(c, 'Category not found'), {
          name: 'name' in body ? requiredString(body, 'name') : undefined,
          description: 'description' in body ? optionalString(body, 'description') : undefined,
          sectionId: 'sectionId' in body ? optionalId(body, 'sectionId') : undefined,
        }),
      );
    })

    .delete('/api/categories/:id', (c) => {
      core.vocabulary.deleteCategory(pathId(c, 'Category not found'));
      return c.body(null, 204);
    })

    .get('/api/sections', (c) => c.json(core.vocabulary.listSections()))

    .post('/api/sections', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.createSection({
          name: requiredString(body, 'name'),
          description: optionalString(body, 'description'),
        }),
        201,
      );
    })

    .patch('/api/sections/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.updateSection(pathId(c, 'Section not found'), {
          name: 'name' in body ? requiredString(body, 'name') : undefined,
          description: 'description' in body ? optionalString(body, 'description') : undefined,
        }),
      );
    })

    .delete('/api/sections/:id', (c) => {
      core.vocabulary.deleteSection(pathId(c, 'Section not found'));
      return c.body(null, 204);
    })

    .get('/api/tags', (c) => c.json(core.vocabulary.listTags()))

    .post('/api/tags', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.createTag({
          name: requiredString(body, 'name'),
          description: optionalString(body, 'description'),
          categoryId: optionalId(body, 'categoryId'),
        }),
        201,
      );
    })

    .patch('/api/tags/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.updateTag(pathId(c, 'Tag not found'), {
          name: 'name' in body ? requiredString(body, 'name') : undefined,
          description: 'description' in body ? optionalString(body, 'description') : undefined,
          categoryId: 'categoryId' in body ? optionalId(body, 'categoryId') : undefined,
        }),
      );
    })

    .post('/api/tags/:id/status', jsonBody, (c) => {
      const status = requiredString(c.req.valid('json'), 'status');
      if (status !== 'active' && status !== 'deprecated') {
        throw new ValidationError('status must be "active" or "deprecated"');
      }
      return c.json(core.vocabulary.setTagStatus(pathId(c, 'Tag not found'), status));
    })

    .delete('/api/tags/:id', (c) => {
      core.vocabulary.deleteTag(pathId(c, 'Tag not found'));
      return c.body(null, 204);
    })

    .get('/api/aggregates', (c) => c.json(core.search.aggregates()))

    .get('/api/review/candidates', (c) => c.json(core.review.listCandidates()))

    .post('/api/review/candidates/accept', jsonBody, async (c) => {
      const body = c.req.valid('json');
      const bookmarkId = requiredString(body, 'bookmarkId');
      const tagId = requiredString(body, 'tagId');
      return c.json(await core.review.acceptCandidate(bookmarkId, tagId));
    })

    .post('/api/import/preview', async (c) => c.json(await core.import.preview(await readImportText(c))))

    .post('/api/import', async (c) =>
      c.json(
        await core.import.import(
          await readImportText(c),
          c.req.query('datasetId') || core.defaultDatasetId,
          { file: c.req.query('file') || undefined },
        ),
      ),
    )

    // Chat streams a UI message stream (AI SDK), not JSON — mounted last so the
    // typed RPC surface above stays clean for apps/web.
    .post('/api/chat', (c) => chatHandler(c))

    .post('/api/reindex', async (c) => c.json(await core.reindex()));

  app.onError((err, c) => {
    const problem = toProblemDetails(err);
    if (!(err instanceof DomainError)) {
      console.error(err);
    }
    return c.json(
      {
        type: `https://al-yo-bo.local/problems/${problem.type}`,
        title: problem.title,
        status: problem.status,
      },
      problem.status as ContentfulStatusCode,
    );
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
