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
  type ExportFilters,
  type ExportFormat,
  type SearchMode,
} from '@al-yo-bo/shared';
import { zipSync } from 'fflate';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import { z } from 'zod';

import { createChatHandler } from './chat.ts';
import type { ServerConfig } from './env.ts';
import { toProblemDetails } from './errors.ts';
import { sseEventsHandler, type EventHub } from './events.ts';
import { lanInterfaces } from './lan.ts';
import { createMcpRoutes, mcpHealth } from './mcp.ts';

/**
 * Transport adapter (ARCHITECTURE §4): parse/validate the HTTP request, call one
 * core service method, serialize the result. No route touches the database, the
 * vector index, or enrichment side effects — those live in `@al-yo-bo/core`, and
 * domain failures arrive here as `DomainError` for `toProblemDetails` to map.
 * One workspace (MODEL.md principle 1): no dataset/section axis anywhere.
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
  /** Ancestor chain from the root, e.g. `["dev", "web", "2024"]` (v2 path grammar). */
  categoryPath: z.array(z.string()),
  priority: z.number().nullable(),
  tags: z.array(z.string()),
});

const importCommitSchema = z.object({
  bookmarks: z.array(importedBookmarkSchema).min(1),
});

/** Drag-reorder of one sibling list (MODEL.md principle 2). */
const categoryReorderSchema = z.object({
  parentId: z.uuid().nullable(),
  orderedIds: z.array(z.uuid()).min(1),
});

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

const categoryReorder = validator('json', (value) => {
  const parsed = categoryReorderSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      '"parentId" (UUID or null) and a non-empty "orderedIds" array of UUIDs are required',
    );
  }
  return parsed.data;
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

/**
 * Parses an ISO date/datetime query param to epoch ms. Date-only values
 * (`YYYY-MM-DD`) expand to UTC day bounds so an inclusive `dateTo` covers the
 * whole end day. Unparseable values are a 400, never silently dropped.
 */
function parseIsoDate(value: string | undefined, field: string, bound: 'from' | 'to'): number | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const time = bound === 'from' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
    return Date.parse(`${value}${time}`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new ValidationError(`"${field}" must be an ISO date (YYYY-MM-DD)`);
  }
  return ms;
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

/** A required UUID-valued body field; malformed ids are a 400, not a codec 500. */
function requiredUuid(body: Record<string, unknown>, field: string): string {
  const value = requiredString(body, field);
  if (!isUuid(value)) {
    throw new ValidationError(`"${field}" must be a valid UUID`);
  }
  return value;
}

/** An optional UUID query param; absent is `undefined`, malformed is a 400. */
function queryUuid(value: string | undefined, field: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!isUuid(value)) {
    throw new ValidationError(`"${field}" must be a valid UUID`);
  }
  return value;
}

/**
 * An optional id-valued body field for references that are checked for
 * existence in core (`categoryId` on bookmarks/tags): absent or `null` → null,
 * otherwise a trimmed string (a malformed UUID surfaces as core's 404/400).
 */
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
 * The `parentId` of a category move: `null` moves to root, a UUID re-parents.
 * Distinct from `optionalId` because a malformed parent id must be a 400 —
 * the tree integrity checks in core assume well-formed ids.
 */
function moveParentId(body: Record<string, unknown>): string | null {
  const value = body['parentId'];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ValidationError('"parentId" must be a valid UUID or null');
  }
  return value;
}

/** Optional fractional key for a move; absent lets the key append after siblings. */
function optionalSortOrder(body: Record<string, unknown>): string | undefined {
  const value = body['sortOrder'];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('"sortOrder" must be a non-empty string');
  }
  return value.trim();
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
export function createApp(core: Core, config: ServerConfig, hub: EventHub) {
  const chatHandler = createChatHandler({
    config,
    search: (query, limit) => core.search.chatHits(query, limit),
  });

  const app = new Hono()
    // The mcp block (ARCHITECTURE §8) is additive at the edge — core's health
    // report stays transport-neutral, the MCP mount is a server concern.
    .get('/api/health', async (c) =>
      c.json({ ...(await core.health.health()), mcp: mcpHealth(config) }),
    )

    .get('/api/bookmarks', async (c) =>
      c.json(
        await core.search.search({
          q: c.req.query('q')?.trim() ?? '',
          mode: parseMode(c.req.query('mode')),
          categoryId: queryUuid(c.req.query('categoryId'), 'categoryId'),
          tagId: queryUuid(c.req.query('tagId'), 'tagId'),
          dateFrom: parseIsoDate(c.req.query('dateFrom'), 'dateFrom', 'from'),
          dateTo: parseIsoDate(c.req.query('dateTo'), 'dateTo', 'to'),
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
      const tagId = requiredUuid(c.req.valid('json'), 'tagId');
      return c.json(await core.bookmarks.assignTag(bookmarkId, tagId));
    })

    .delete('/api/bookmarks/:id/tags/:tagId', async (c) => {
      const bookmarkId = pathId(c, 'Bookmark not found');
      const tagId = pathId(c, 'Tag not found', 'tagId');
      await core.bookmarks.removeTag(bookmarkId, tagId);
      return c.body(null, 204);
    })

    // The nested tree the sidebar consumes (roots, then children in sort_order).
    .get('/api/categories', (c) => c.json(core.vocabulary.getCategoryTree()))

    .post('/api/categories', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.createCategory({
          name: requiredString(body, 'name'),
          description: optionalString(body, 'description'),
          parentId: optionalId(body, 'parentId'),
        }),
        201,
      );
    })

    // Update and move share one PATCH: a body carrying `parentId` re-parents
    // (subtree included, optional fractional `sortOrder`); otherwise it renames.
    .patch('/api/categories/:id', jsonBody, (c) => {
      const body = c.req.valid('json');
      const id = pathId(c, 'Category not found');
      if ('parentId' in body) {
        return c.json(core.vocabulary.moveCategory(id, moveParentId(body), optionalSortOrder(body)));
      }
      return c.json(
        core.vocabulary.updateCategory(id, {
          name: 'name' in body ? requiredString(body, 'name') : undefined,
          description: 'description' in body ? optionalString(body, 'description') : undefined,
        }),
      );
    })

    // Persists a full drag-reorder of one sibling list (parentId null = roots).
    .post('/api/categories/reorder', categoryReorder, (c) => {
      const { parentId, orderedIds } = c.req.valid('json');
      return c.json(core.vocabulary.reorderCategories(parentId, orderedIds));
    })

    // The response carries the subtree counts the confirmation UI showed
    // (MODEL.md deletion semantics: bookmarks survive, category_id → NULL).
    .delete('/api/categories/:id', async (c) =>
      c.json(await core.vocabulary.deleteCategory(pathId(c, 'Category not found'))),
    )

    .get('/api/tags', (c) => c.json(core.vocabulary.listTags()))

    .post('/api/tags', jsonBody, (c) => {
      const body = c.req.valid('json');
      return c.json(
        core.vocabulary.createTag({
          name: requiredString(body, 'name'),
          description: optionalString(body, 'description'),
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
        }),
      );
    })

    // Tag lifecycle hook (§7 stage 0): only `active` tags are classifier candidates.
    .post('/api/tags/:id/status', jsonBody, (c) => {
      const status = requiredString(c.req.valid('json'), 'status');
      if (status !== 'active' && status !== 'deprecated') {
        throw new ValidationError('status must be "active" or "deprecated"');
      }
      return c.json(core.vocabulary.setTagStatus(pathId(c, 'Tag not found'), status));
    })

    .delete('/api/tags/:id', async (c) => {
      await core.vocabulary.deleteTag(pathId(c, 'Tag not found'));
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

    .delete('/api/profile/avatar', async (c) => c.json(await core.profile.clearAvatar()))

    .get('/api/review/candidates', (c) => c.json(core.review.listCandidates()))

    .post('/api/review/candidates/accept', jsonBody, async (c) => {
      const body = c.req.valid('json');
      const bookmarkId = requiredUuid(body, 'bookmarkId');
      const tagId = requiredUuid(body, 'tagId');
      return c.json(await core.review.acceptCandidate(bookmarkId, tagId));
    })

    .post('/api/import/preview', async (c) =>
      c.json(await core.import.preview(await readImportText(c))),
    )

    // Commit the user-reviewed/edited list directly (no re-extraction).
    .post('/api/import', importCommit, (c) => {
      const { bookmarks } = c.req.valid('json');
      const file = c.req.query('file') || undefined;
      return c.json(core.import.commit(bookmarks, { file }));
    })

    // Bookmark export (ARCHITECTURE §7): a synchronous request/response,
    // never a job. Core owns filter/format validation and serialization; this
    // adapter only parses the query and packages bytes — a single format streams
    // that file, multiple formats are zipped here at the edge with fflate.
    .get('/api/export', async (c) => {
      const filters: ExportFilters = {};
      const q = c.req.query('q')?.trim();
      if (q) {
        filters.q = q;
      }
      const categoryId = queryUuid(c.req.query('categoryId'), 'categoryId');
      if (categoryId) {
        filters.categoryId = categoryId;
      }
      const tagId = queryUuid(c.req.query('tagId'), 'tagId');
      if (tagId) {
        filters.tagId = tagId;
      }
      filters.status = parseStatus(c.req.query('status'));
      const dateFrom = parseIsoDate(c.req.query('dateFrom'), 'dateFrom', 'from');
      if (dateFrom !== undefined) {
        filters.dateFrom = dateFrom;
      }
      const dateTo = parseIsoDate(c.req.query('dateTo'), 'dateTo', 'to');
      if (dateTo !== undefined) {
        filters.dateTo = dateTo;
      }

      // Core rejects unknown/empty formats at runtime (400 via ValidationError);
      // the assertion only narrows the repeated query strings for the typed call.
      const formats = (c.req.queries('formats') ?? []) as ExportFormat[];
      const files = await core.export.run(filters, formats);

      const file = files[0];
      if (files.length === 1 && file) {
        return new Response(file.content, {
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${file.filename}"`,
          },
        });
      }

      const encoder = new TextEncoder();
      const entries: Record<string, Uint8Array> = {};
      for (const exported of files) {
        entries[exported.filename] = encoder.encode(exported.content);
      }
      const date = new Date().toISOString().slice(0, 10);
      return new Response(zipSync(entries), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="alyobo-export-${date}.zip"`,
        },
      });
    })

    // Coarse domain events over SSE (ARCHITECTURE §9): opens with a synthetic
    // `invalidate-all`, then fans out core's hints. Consumed via EventSource,
    // not the typed RPC client.
    .get('/api/events', sseEventsHandler(hub))

    // Chat streams a UI message stream (AI SDK), not JSON — mounted last so the
    // typed RPC surface above stays clean for apps/web.
    .post('/api/chat', (c) => chatHandler(c))

    .post('/api/reindex', async (c) => c.json(await core.reindex()))

    // Bookmarks MCP server (ARCHITECTURE §8): streamable HTTP at /mcp, guarded
    // by the adapter's localhost Host/Origin middleware plus the optional
    // MCP_TOKEN bearer check. Mounted last so the typed RPC surface above
    // stays clean for apps/web, like /api/chat.
    .route('/mcp', createMcpRoutes(core, config));

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
