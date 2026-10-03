import type { Database, SQLQueryBindings } from 'bun:sqlite';

import {
  bytesToUuid,
  clampPagination,
  newIdBytes,
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
import { getTagsForBookmarks } from './bookmark-tags.ts';
import { prepared } from './statements.ts';

const COLUMNS =
  'id, dataset_id, url, title, description, content, metadata, category_id, content_hash, scraped_at, status, scrape_attempts, created_at, updated_at';

export interface BookmarkInput {
  datasetId: string;
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
  datasetId?: string;
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
  datasetId?: string;
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
  return bookmarks.map((bookmark) => ({
    ...bookmark,
    tags: tags.get(bookmark.id) ?? [],
    // Surfaced on every read path (list/search/detail) so the UI can render
    // the screenshot → og:image → placeholder chain without touching metadata.
    image: parseBookmarkImage(bookmark.metadata),
  }));
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

  if (filters.datasetId) {
    where.push('dataset_id = ?');
    params.push(uuidToBytes(filters.datasetId));
  }
  if (filters.categoryId) {
    where.push('category_id = ?');
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

/**
 * URL lookup scoped to one dataset (the unique index is `(dataset_id, url)`
 * since migration 0008 — the same URL may exist in different datasets).
 */
export function getBookmarkByUrl(db: Database, datasetId: string, url: string): Bookmark | null {
  const row = prepared<BookmarkRow, [Uint8Array, string]>(
    db,
    `SELECT ${COLUMNS} FROM bookmarks WHERE dataset_id = ? AND url = ?`,
  ).get(uuidToBytes(datasetId), normalizeUrl(url));
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
      `INSERT INTO bookmarks (id, dataset_id, url, title, description, content, metadata, category_id, content_hash, scraped_at, status, scrape_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      uuidToBytes(input.datasetId),
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
  patch: Partial<Omit<BookmarkInput, 'datasetId'>>,
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
 * Idempotent upsert keyed on the normalized URL **within the input's dataset**
 * — imports into dataset A never touch a bookmark with the same URL in
 * dataset B.
 *
 * On update, `metadata` is shallow-merged over the existing row rather than
 * replaced: re-importing a collection refreshes the importer's `import` block
 * while preserving provenance the importer does not own (`scrape`, `image`),
 * per ARCHITECTURE §7 merge-by-URL. `updateBookmark` stays a replace-setter so
 * internal writers can intentionally clear a subtree.
 */
export function upsertBookmarkByUrl(
  db: Database,
  input: BookmarkInput,
): { bookmark: Bookmark; created: boolean } {
  const existing = getBookmarkByUrl(db, input.datasetId, input.url);
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

export function countBookmarks(db: Database, datasetId?: string): number {
  if (!datasetId) {
    return (
      prepared<{ count: number }, []>(db, 'SELECT COUNT(*) AS count FROM bookmarks').get()?.count ??
      0
    );
  }
  return (
    prepared<{ count: number }, [Uint8Array]>(
      db,
      'SELECT COUNT(*) AS count FROM bookmarks WHERE dataset_id = ?',
    ).get(uuidToBytes(datasetId))?.count ?? 0
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
 * Startup-reconciliation input (ARCHITECTURE §8): bookmarks that have never been
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
 * Bookmarks that still need a screenshot (ARCHITECTURE §8, post-simplification):
 * they have neither a local `metadata.image.screenshotPath` nor a remote
 * `metadata.image.ogImageUrl` — the placeholder fallback in the UI is the last
 * resort, so reconciliation retries the capture on the next start.
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
 * Rebuilds the FTS5 index from the bookmarks table (the `reindex` job, §8). The
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

  if (params.datasetId) {
    where.push('b.dataset_id = ?');
    bind.push(uuidToBytes(params.datasetId));
  }
  if (params.categoryId) {
    where.push('b.category_id = ?');
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
