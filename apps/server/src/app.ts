import {
  DomainError,
  NotFoundError,
  ValidationError,
  type BookmarkPatch,
  type Core,
  type ProfilePatchInput,
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
import { z } from 'zod';

import { createChatHandler } from './chat.ts';
import type { ServerConfig } from './env.ts';
import { toProblemDetails } from './errors.ts';
import { lanInterfaces } from './lan.ts';

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

/** Mirrors the `ImportedBookmark` contract the preview returns and the client edits. */
const importedBookmarkSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  priority: z.number().nullable(),
  tags: z.array(z.string()),
});

const importCommitSchema = z.object({
  bookmarks: z.array(importedBookmarkSchema).min(1),
});

/** Upload size cap for the avatar (local single-user tool; images are small). */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Sniffs the image format from magic bytes rather than trusting the multipart
 * content type (which the client controls). Only JPEG and PNG are accepted —
 * the avatar route stores files with a fixed extension per format.
 */
function avatarExt(bytes: Uint8Array): 'jpg' | 'png' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  return null;
}

/**
 * Commit-body validator. Returning the parsed object (rather than a bare
 * `Record<string, unknown>`) keeps the Hono RPC input type precise so
 * `apps/web` can call `api.api.import.$post({ json: { bookmarks } })`.
 */
const importCommit = validator('json', (value) => {
  const parsed = importCommitSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      '"bookmarks" must be a non-empty array of bookmark objects each with a "url"',
    );
  }
  return parsed.data;
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
 * Validates an `:id`-style path parameter before it reaches core: non-UUID
 * strings would otherwise surface as a 500 from deep inside the UUID codec.
 * Invalid (not just unknown) ids map to NotFoundError, matching neighboring
 * routes so a malformed id cannot distinguish "missing" from "malformed".
 */
function pathId(c: Context, message: string, param = 'id'): string {
  const id = c.req.param(param) ?? '';
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
      const tagId = pathId(c, 'Tag not found', 'tagId');
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

    // Local-network interfaces so clients can render LAN URLs themselves (they
    // know their own location.port). No URLs here — and unauthenticated like the
    // other local routes.
    .get('/api/lan', (c) => c.json(lanInterfaces()))

    .get('/api/profile', (c) => c.json(core.profile.get()))

    .patch('/api/profile', jsonBody, (c) => {
      const body = c.req.valid('json');
      const patch: ProfilePatchInput = {};
      if ('name' in body) {
        patch.name = optionalString(body, 'name');
      }
      if ('githubUsername' in body) {
        patch.githubUsername = optionalString(body, 'githubUsername');
      }
      if ('activeDatasetId' in body) {
        patch.activeDatasetId = optionalId(body, 'activeDatasetId');
      }
      return c.json(core.profile.update(patch));
    })

    // The app's only binary upload: one multipart file field named "avatar".
    .post('/api/profile/avatar', async (c) => {
      const form = await c.req.parseBody();
      const file = form['avatar'];
      if (!(file instanceof File)) {
        throw new ValidationError('"avatar" file field is required');
      }
      if (file.size > MAX_AVATAR_BYTES) {
        throw new ValidationError('"avatar" must be at most 2 MB');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = avatarExt(bytes);
      if (!ext) {
        throw new ValidationError('"avatar" must be a JPEG or PNG image');
      }
      return c.json(await core.profile.saveAvatar({ bytes, ext }));
    })

    .get('/api/review/candidates', (c) => c.json(core.review.listCandidates()))

    .post('/api/review/candidates/accept', jsonBody, async (c) => {
      const body = c.req.valid('json');
      const bookmarkId = requiredString(body, 'bookmarkId');
      const tagId = requiredString(body, 'tagId');
      return c.json(await core.review.acceptCandidate(bookmarkId, tagId));
    })

    .post('/api/import/preview', async (c) =>
      c.json(await core.import.preview(await readImportText(c))),
    )

    // Commit the user-reviewed/edited list directly (no re-extraction).
    .post('/api/import', importCommit, (c) => {
      const { bookmarks } = c.req.valid('json');
      const datasetIdParam = c.req.query('datasetId');
      // A non-UUID datasetId would 500 inside the UUID codec; fail as 400 first.
      if (datasetIdParam !== undefined && !isUuid(datasetIdParam)) {
        throw new ValidationError('"datasetId" must be a valid UUID');
      }
      const datasetId = datasetIdParam || core.defaultDatasetId;
      const file = c.req.query('file') || undefined;
      return c.json(core.import.commit(bookmarks, datasetId, { file }));
    })

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
