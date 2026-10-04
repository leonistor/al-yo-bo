import type { Database, SQLQueryBindings } from 'bun:sqlite';

import {
  bytesToUuid,
  clampPagination,
  normalizeUrl,
  toFtsMatch,
  uuidToBytes,
  type Bookmark,
  type BookmarkListStatus,
  type BookmarkSort,
  type BookmarkStatus,
  type BookmarkWithTags,
  type RankedCandidate,
} from '@al-yo-bo/shared';

import { mapBookmark, parseBookmarkImage, type BookmarkRow } from '../row-mapping.ts';
import { newIdBytes } from '../uuid.ts';
import { getTagsForBookmarks } from './bookmark-tags.ts';
import { CATEGORY_SUBTREE_IN } from './categories.ts';
import { prepared } from './statements.ts';

/**
 * Bookmark CRUD and the list/search filter machinery. One workspace: there is
 * no dataset axis anywhere, and the URL is the global upsert key (MODEL.md
 * principles 1 and the `bookmarks_url_unique` index). The category filter
 * matches the whole category subtree via `CATEGORY_SUBTREE_IN`.
 */

const COLUMNS =
  'id, url, title, description, content, metadata, category_id, content_hash, scraped_at, status, scrape_attempts, created_at, updated_at';

export interface BookmarkInput {
  url: string;
  title?: string | null;
  description?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
  categoryId?: string | null;
  contentHash?: string | null;
  scrapedAt?: number | null;
  status?: BookmarkStatus;
  scrapeAttempts?: number;
}

export interface ListBookmarksFilters {
  /** Full-text query (FTS5 over url/title/description/content); empty ⇒ no text constraint. */
  q?: string;
  /** Matches the category and its whole subtree (see `CATEGORY_SUBTREE_IN`). */
  categoryId?: string;
  tagId?: string;
  dateFrom?: number;
  dateTo?: number;
  status?: BookmarkListStatus;
  sort?: BookmarkSort;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface KeywordSearchParams {
  q: string;
  categoryId?: string;
  tagId?: string;
  dateFrom?: number;
  dateTo?: number;
  status?: BookmarkListStatus;
  limit?: number;
  offset?: number;
}

function hydrate(db: Database, rows: BookmarkRow[]): BookmarkWithTags[] {
  const bookmarks = rows.map(mapBookmark);
  const tags = getTagsForBookmarks(
    db,
    bookmarks.map((bookmark) => bookmark.id),
  );
  // Object.assign instead of a spread (oxc/no-map-spread): the row objects are
  // freshly created by mapBookmark above, so in-place extension is safe.
  return bookmarks.map((bookmark) =>
    Object.assign(bookmark, {
      tags: tags.get(bookmark.id) ?? [],
      // Surfaced on every read path (list/search/detail) so the UI can render
      // the screenshot → og:image → placeholder chain without touching metadata.
      image: parseBookmarkImage(bookmark.metadata),
    }),
  );
}

function sortColumn(sort: BookmarkSort = 'created_at'): string {
  switch (sort) {
    case 'title':
      return 'title COLLATE NOCASE';
    case 'updated_at':
      return 'updated_at';
    default:
      return 'created_at';
  }
}

/**
 * SQLite's default host-parameter limit is 999; IN-lists are chunked well below
 * it so large id sets never throw "too many SQL variables".
 */
const IN_CLAUSE_CHUNK = 500;

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CLAUSE_CHUNK) {
    chunks.push(ids.slice(i, i + IN_CLAUSE_CHUNK));
  }
  return chunks;
}

function buildFilterClauses(filters: ListBookmarksFilters): {
  whereSql: string;
  params: SQLQueryBindings[];
} {
  const where: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filters.q) {
    const match = toFtsMatch(filters.q);
    // A whitespace-only query tokenizes to nothing; dropping the clause matches
    // keywordSearch's behavior (no match string ⇒ no text constraint).
    if (match) {
      where.push('id IN (SELECT bookmark_id FROM bookmark_fts WHERE bookmark_fts MATCH ?)');
      params.push(match);
    }
  }
  if (filters.categoryId) {
    // Subtree expansion (MODEL.md principle 2): a bookmark in a child category
    // matches a parent-category filter — the recursive CTE resolves the
    // descendant set inside SQLite with one bound parameter.
    where.push(`category_id ${CATEGORY_SUBTREE_IN}`);
    params.push(uuidToBytes(filters.categoryId));
  }
  if (filters.tagId) {
    where.push('id IN (SELECT bookmark_id FROM bookmark_tags WHERE tag_id = ?)');
    params.push(uuidToBytes(filters.tagId));
  }
  if (filters.dateFrom !== undefined) {
    where.push('created_at >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo !== undefined) {
    where.push('created_at <= ?');
    params.push(filters.dateTo);
  }
  if (filters.status && filters.status !== 'all') {
    where.push('status = ?');
    params.push(filters.status);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function getBookmarkById(db: Database, id: string): Bookmark | null {
  const row = prepared<BookmarkRow, [Uint8Array]>(
    db,
    `SELECT ${COLUMNS} FROM bookmarks WHERE id = ?`,
  ).get(uuidToBytes(id));
  return row ? mapBookmark(row) : null;
}

/** Global URL lookup — the unique index is `bookmarks_url_unique` (one workspace). */
export function getBookmarkByUrl(db: Database, url: string): Bookmark | null {
  const row = prepared<BookmarkRow, [string]>(
    db,
    `SELECT ${COLUMNS} FROM bookmarks WHERE url = ?`,
  ).get(normalizeUrl(url));
  return row ? mapBookmark(row) : null;
}

/**
 * Insert-then-read runs in one immediate transaction, closing the TOCTOU gap
 * where another connection could write between the insert and the read-back.
 */
export function createBookmark(db: Database, input: BookmarkInput): Bookmark {
  const run = db.transaction(() => {
    const id = newIdBytes();
    prepared(
      db,
      `INSERT INTO bookmarks (id, url, title, description, content, metadata, category_id, content_hash, scraped_at, status, scrape_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      normalizeUrl(input.url),
      input.title ?? null,
      input.description ?? null,
      input.content ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.categoryId ? uuidToBytes(input.categoryId) : null,
      input.contentHash ?? null,
      input.scrapedAt ?? null,
      input.status ?? 'active',
      input.scrapeAttempts ?? 0,
    );
    const created = getBookmarkById(db, bytesToUuid(id));
    if (!created) {
      throw new Error('Bookmark insert did not persist');
    }
    return created;
  });
  return run.immediate();
}

export function updateBookmark(
  db: Database,
  id: string,
  patch: Partial<BookmarkInput>,
): Bookmark | null {
  const current = getBookmarkById(db, id);
  if (!current) {
    return null;
  }

  const url = patch.url !== undefined ? normalizeUrl(patch.url) : current.url;
  const title = patch.title !== undefined ? patch.title : current.title;
  const description = patch.description !== undefined ? patch.description : current.description;
  const content = patch.content !== undefined ? patch.content : current.content;
  const metadata =
    patch.metadata !== undefined
      ? patch.metadata
        ? JSON.stringify(patch.metadata)
        : null
      : current.metadata
        ? JSON.stringify(current.metadata)
        : null;
  const categoryId = patch.categoryId !== undefined ? patch.categoryId : current.categoryId;
  const contentHash = patch.contentHash !== undefined ? patch.contentHash : current.contentHash;
  const scrapedAt = patch.scrapedAt !== undefined ? patch.scrapedAt : current.scrapedAt;
  const status = patch.status !== undefined ? patch.status : current.status;
  const scrapeAttempts =
    patch.scrapeAttempts !== undefined ? patch.scrapeAttempts : current.scrapeAttempts;

  prepared(
    db,
    `UPDATE bookmarks
        SET url = ?, title = ?, description = ?, content = ?, metadata = ?, category_id = ?, content_hash = ?, scraped_at = ?, status = ?, scrape_attempts = ?
      WHERE id = ?`,
  ).run(
    url,
    title,
    description,
    content,
    metadata,
    categoryId ? uuidToBytes(categoryId) : null,
    contentHash,
    scrapedAt,
    status,
    scrapeAttempts,
    uuidToBytes(id),
  );

  return getBookmarkById(db, id);
}

/**
 * Idempotent upsert keyed on the normalized URL — globally unique, so an
 * import merges with the one row that URL can have (ARCHITECTURE §7
 * merge-by-URL).
 *
 * On update, `metadata` is shallow-merged over the existing row rather than
 * replaced: re-importing a collection refreshes the importer's `import` block
 * while preserving provenance the importer does not own (`scrape`, `image`).
 * `updateBookmark` stays a replace-setter so internal writers can
 * intentionally clear a field.
 */
export function upsertBookmarkByUrl(
  db: Database,
  input: BookmarkInput,
): { bookmark: Bookmark; created: boolean } {
  const existing = getBookmarkByUrl(db, input.url);
  if (!existing) {
    return { bookmark: createBookmark(db, input), created: true };
  }
  const metadata = input.metadata ? { ...existing.metadata, ...input.metadata } : undefined;
  const updated = updateBookmark(db, existing.id, { ...input, metadata });
  if (!updated) {
    throw new Error('Bookmark upsert failed');
  }
  return { bookmark: updated, created: false };
}

export function deleteBookmark(db: Database, id: string): boolean {
  const result = prepared(db, 'DELETE FROM bookmarks WHERE id = ?').run(uuidToBytes(id));
  return result.changes > 0;
}

export function countBookmarks(db: Database): number {
  return (
    prepared<{ count: number }, []>(db, 'SELECT COUNT(*) AS count FROM bookmarks').get()?.count ?? 0
  );
}

/**
 * Batched id → status lookup, so callers filtering a candidate list (e.g. semantic
 * search) issue a few queries instead of one per id. Unknown ids are absent from
 * the map.
 */
export function getBookmarkStatuses(db: Database, ids: string[]): Map<string, BookmarkStatus> {
  const statuses = new Map<string, BookmarkStatus>();
  for (const chunk of chunkIds(ids)) {
    const placeholders = chunk.map(() => '?').join(', ');
    // Dynamic arity (varies with chunk size) — intentionally not cached.
    const rows = db
      .query<{ id: Uint8Array; status: string }, Uint8Array[]>(
        `SELECT id, status FROM bookmarks WHERE id IN (${placeholders})`,
      )
      .all(...chunk.map(uuidToBytes));
    for (const row of rows) {
      statuses.set(bytesToUuid(row.id), row.status as BookmarkStatus);
    }
  }
  return statuses;
}

/**
 * Startup-reconciliation input (ARCHITECTURE §10): bookmarks that have never been
 * successfully scraped. A failed scrape leaves `scraped_at` NULL, so it is
 * retried on the next server start.
 */
export function listBookmarkIdsMissingContent(db: Database): string[] {
  return prepared<{ id: Uint8Array }, []>(
    db,
    `SELECT id FROM bookmarks WHERE scraped_at IS NULL AND status = 'active'`,
  )
    .all()
    .map((row) => bytesToUuid(row.id));
}

/**
 * Bookmarks that still need a screenshot (ARCHITECTURE §10): they have neither
 * a local `metadata.image.screenshotPath` nor a remote `metadata.image.ogImageUrl`
 * — the placeholder fallback in the UI is the last resort, so reconciliation
 * retries the capture on the next start.
 */
export function listBookmarkIdsMissingScreenshot(db: Database): string[] {
  return prepared<{ id: Uint8Array }, []>(
    db,
    `SELECT id FROM bookmarks
        WHERE status = 'active'
          AND (
            metadata IS NULL
            OR json_extract(metadata, '$.image.screenshotPath') IS NULL
          )
          AND (
            metadata IS NULL
            OR json_extract(metadata, '$.image.ogImageUrl') IS NULL
          )`,
  )
    .all()
    .map((row) => bytesToUuid(row.id));
}

/**
 * Rebuilds the FTS5 index from the bookmarks table (the `reindex` job, §10). The
 * trigger-sync normally keeps it current; this repairs drift or corruption.
 * Returns the number of indexed rows.
 */
export function rebuildFts(db: Database): number {
  const run = db.transaction(() => {
    prepared(db, 'DELETE FROM bookmark_fts').run();
    prepared(
      db,
      `INSERT INTO bookmark_fts (bookmark_id, url, title, description, content)
       SELECT id, url, title, description, content FROM bookmarks`,
    ).run();
    return prepared<{ count: number }, []>(db, 'SELECT COUNT(*) AS count FROM bookmark_fts').get()!
      .count;
  });
  return run.immediate();
}

export function listBookmarks(
  db: Database,
  filters: ListBookmarksFilters = {},
): { items: BookmarkWithTags[]; total: number } {
  const { limit, offset } = clampPagination(filters.limit, filters.offset);
  const { whereSql, params } = buildFilterClauses(filters);

  const total =
    prepared<{ count: number }, SQLQueryBindings[]>(
      db,
      `SELECT COUNT(*) AS count FROM bookmarks ${whereSql}`,
    ).get(...params)?.count ?? 0;

  const direction = filters.direction === 'asc' ? 'ASC' : 'DESC';
  const rows = prepared<BookmarkRow, SQLQueryBindings[]>(
    db,
    `SELECT ${COLUMNS} FROM bookmarks ${whereSql}
        ORDER BY ${sortColumn(filters.sort)} ${direction}, created_at DESC
        LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  return { items: hydrate(db, rows), total };
}

/**
 * Full, uncapped read for exports. Deliberately skips `listBookmarks`'
 * pagination window so an export reflects the entire filtered set; the
 * 100-row `clampPagination` cap is a presentation concern enforced above this
 * layer, never here (ARCHITECTURE §7 export). `created_at DESC, id` is a total
 * order (ids are unique), so repeated exports are byte-stable.
 */
export function listBookmarksForExport(
  db: Database,
  filters: ListBookmarksFilters = {},
): BookmarkWithTags[] {
  const { whereSql, params } = buildFilterClauses(filters);
  const rows = prepared<BookmarkRow, SQLQueryBindings[]>(
    db,
    `SELECT ${COLUMNS} FROM bookmarks ${whereSql}
        ORDER BY created_at DESC, id`,
  ).all(...params);
  return hydrate(db, rows);
}

export function getBookmarksWithTagsByIds(db: Database, ids: string[]): BookmarkWithTags[] {
  const unique = [...new Set(ids)];
  const byId = new Map<string, BookmarkWithTags>();
  for (const chunk of chunkIds(unique)) {
    const placeholders = chunk.map(() => '?').join(', ');
    // Dynamic arity (varies with chunk size) — intentionally not cached.
    const rows = db
      .query<BookmarkRow, Uint8Array[]>(
        `SELECT ${COLUMNS} FROM bookmarks WHERE id IN (${placeholders})`,
      )
      .all(...chunk.map(uuidToBytes));
    for (const bookmark of hydrate(db, rows)) {
      byId.set(bookmark.id, bookmark);
    }
  }
  return unique
    .map((id) => byId.get(id))
    .filter((bookmark): bookmark is BookmarkWithTags => bookmark !== undefined);
}

/**
 * Shared WHERE-clause builder for `keywordSearch`/`countKeywordMatches` so the
 * two queries can never drift apart on filter semantics.
 */
function buildFtsWhere(
  params: KeywordSearchParams,
  match: string,
): { where: string; bind: SQLQueryBindings[] } {
  const where = ['bookmark_fts MATCH ?'];
  const bind: SQLQueryBindings[] = [match];

  if (params.categoryId) {
    // Same subtree semantics as listBookmarks (see buildFilterClauses).
    where.push(`b.category_id ${CATEGORY_SUBTREE_IN}`);
    bind.push(uuidToBytes(params.categoryId));
  }
  if (params.tagId) {
    where.push('b.id IN (SELECT bookmark_id FROM bookmark_tags WHERE tag_id = ?)');
    bind.push(uuidToBytes(params.tagId));
  }
  if (params.dateFrom !== undefined) {
    where.push('b.created_at >= ?');
    bind.push(params.dateFrom);
  }
  if (params.dateTo !== undefined) {
    where.push('b.created_at <= ?');
    bind.push(params.dateTo);
  }
  if (params.status && params.status !== 'all') {
    where.push('b.status = ?');
    bind.push(params.status);
  }

  return { where: where.join(' AND '), bind };
}

/**
 * Keyword candidates from FTS5, BM25-ranked (lower/negative is better). This is
 * the only SQL in the keyword path; `packages/search` fuses the ranked lists.
 */
export function keywordSearch(db: Database, params: KeywordSearchParams): RankedCandidate[] {
  const match = toFtsMatch(params.q);
  if (!match) {
    return [];
  }

  const { limit, offset } = clampPagination(params.limit, params.offset);
  const { where, bind } = buildFtsWhere(params, match);

  const rows = prepared<{ id: Uint8Array; score: number; snippet: string }, SQLQueryBindings[]>(
    db,
    // FTS5 column 4 is `content` (bookmark_id, url, title, description,
    // content). snippet() returns '' when the match is only in another
    // column (e.g. title), so fall back to the title for display.
    `SELECT b.id AS id, bm25(bookmark_fts) AS score,
              COALESCE(NULLIF(snippet(bookmark_fts, 4, '[', ']', '…', 12), ''), b.title) AS snippet
         FROM bookmark_fts
         JOIN bookmarks b ON b.id = bookmark_fts.bookmark_id
        WHERE ${where}
        ORDER BY score
        LIMIT ? OFFSET ?`,
  ).all(...bind, limit, offset);

  return rows.map((row, index) => ({
    bookmarkId: bytesToUuid(row.id),
    rank: index + 1,
    score: row.score,
    snippet: row.snippet,
  }));
}

/** Number of FTS5 matches for a keyword query (same filters as `keywordSearch`). */
export function countKeywordMatches(db: Database, params: KeywordSearchParams): number {
  const match = toFtsMatch(params.q);
  if (!match) {
    return 0;
  }

  const { where, bind } = buildFtsWhere(params, match);

  return (
    prepared<{ count: number }, SQLQueryBindings[]>(
      db,
      `SELECT COUNT(*) AS count
           FROM bookmark_fts
           JOIN bookmarks b ON b.id = bookmark_fts.bookmark_id
          WHERE ${where}`,
    ).get(...bind)?.count ?? 0
  );
}
