import type { Database } from 'bun:sqlite';

import { getCategoryTree, listBookmarksForExport, listCategories } from '@al-yo-bo/db';
import {
  EXPORT_CONTENT_TYPES,
  filenameFor,
  toCsv,
  toExportJson,
  toMarkdownCollection,
  toNetscapeHtml,
} from '@al-yo-bo/exporter';
import type {
  BookmarkWithTags,
  Category,
  CategoryNode,
  ExportBookmarkRow,
  ExportFilters,
  ExportFormat,
  ExportedFile,
} from '@al-yo-bo/shared';

import { ValidationError } from '../errors.ts';

export interface ExportServiceDeps {
  db: Database;
}

export interface ExportService {
  run(filters: ExportFilters, formats: ExportFormat[]): Promise<ExportedFile[]>;
}

function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && value in EXPORT_CONTENT_TYPES;
}

/**
 * Resolves each bookmark's category ancestor chain — the one path grammar
 * shared by every export format (ARCHITECTURE §7): `["dev", "web", "2024"]`.
 * Categories are loaded once and chains are memoized per distinct category id,
 * so resolution is O(categories + bookmarks) instead of one recursive query
 * per row.
 */
function resolveCategoryPaths(db: Database, bookmarks: BookmarkWithTags[]): ExportBookmarkRow[] {
  const categories = new Map(listCategories(db).map((category) => [category.id, category]));
  const paths = new Map<string, string[]>();

  const pathOf = (categoryId: string): string[] => {
    const cached = paths.get(categoryId);
    if (cached) {
      return cached;
    }
    const chain: string[] = [];
    let cursor: string | null = categoryId;
    while (cursor) {
      const category: Category | undefined = categories.get(cursor);
      // The FK guarantees existence; an unknown id (torn read) degrades to a
      // partial path instead of failing the whole export.
      if (!category) {
        break;
      }
      chain.unshift(category.name);
      cursor = category.parentId;
    }
    paths.set(categoryId, chain);
    return chain;
  };

  return bookmarks.map((bookmark) =>
    Object.assign({}, bookmark, {
      categoryPath: bookmark.categoryId ? pathOf(bookmark.categoryId) : [],
    }),
  );
}

function serialize(
  format: ExportFormat,
  bookmarks: ExportBookmarkRow[],
  filters: ExportFilters,
  exportedAt: number,
  categories: CategoryNode[],
): string {
  switch (format) {
    case 'html':
      return toNetscapeHtml(bookmarks);
    case 'json':
      // The JSON backup carries the full category tree (getCategoryTree output)
      // alongside the per-row paths (ARCHITECTURE §7, exporter's meta contract).
      return toExportJson(bookmarks, { filters: { ...filters }, exportedAt, categories });
    case 'csv':
      return toCsv(bookmarks);
    case 'markdown':
      return toMarkdownCollection(bookmarks);
  }
}

/**
 * Bookmark export (ARCHITECTURE §7: jobs are enrichment-only). Export is a
 * synchronous request/response the caller waits on — nothing is queued. The DB
 * read is uncapped so exports are not truncated to a list page; the server edge
 * owns transport concerns (zip packaging, streaming, download headers).
 */
export function createExportService(deps: ExportServiceDeps): ExportService {
  const { db } = deps;

  return {
    async run(filters, formats) {
      // Dedupe while preserving the caller's order; reject anything unknown at
      // runtime (formats arrive from HTTP, so the TS type is not a guarantee).
      const unique: ExportFormat[] = [];
      for (const format of formats) {
        if (!isExportFormat(format)) {
          throw new ValidationError(`Unsupported export format: ${String(format)}`);
        }
        if (!unique.includes(format)) {
          unique.push(format);
        }
      }
      if (unique.length === 0) {
        throw new ValidationError('At least one export format is required');
      }

      const rows = resolveCategoryPaths(db, listBookmarksForExport(db, { ...filters }));
      const exportedAt = Date.now();
      const categories = getCategoryTree(db);

      return unique.map((format) => ({
        filename: filenameFor(format),
        contentType: EXPORT_CONTENT_TYPES[format],
        content: serialize(format, rows, filters, exportedAt, categories),
      }));
    },
  };
}
