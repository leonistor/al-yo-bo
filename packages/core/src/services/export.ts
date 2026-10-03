import type { Database } from 'bun:sqlite';

import { listBookmarksForExport, listCategories, listSections } from '@al-yo-bo/db';
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
  ExportBookmarkRow,
  ExportFilters,
  ExportFormat,
  ExportedFile,
} from '@al-yo-bo/shared';

import { ValidationError } from '../errors.ts';

export interface ExportServiceDeps {
  db: Database;
  datasetId: string;
}

export interface ExportService {
  run(filters: ExportFilters, formats: ExportFormat[]): Promise<ExportedFile[]>;
}

function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && value in EXPORT_CONTENT_TYPES;
}

function serialize(
  format: ExportFormat,
  bookmarks: ExportBookmarkRow[],
  filters: ExportFilters,
  exportedAt: number,
): string {
  switch (format) {
    case 'html':
      return toNetscapeHtml(bookmarks);
    case 'json':
      return toExportJson(bookmarks, { filters: { ...filters }, exportedAt });
    case 'csv':
      return toCsv(bookmarks);
    case 'markdown':
      return toMarkdownCollection(bookmarks);
  }
}

/**
 * Bookmark export (ARCHITECTURE §8: jobs are enrichment-only). Export is a
 * synchronous request/response the caller waits on — nothing is queued. The DB
 * read is uncapped so exports are not truncated to a list page; the server edge
 * owns transport concerns (zip packaging, streaming, download headers).
 */
export function createExportService(deps: ExportServiceDeps): ExportService {
  const { db, datasetId } = deps;

  function resolveVocabulary(bookmarks: BookmarkWithTags[]): ExportBookmarkRow[] {
    const categories = new Map(
      listCategories(db, datasetId).map((category) => [category.id, category]),
    );
    const sections = new Map(
      listSections(db, datasetId).map((section) => [section.id, section.name]),
    );
    return bookmarks.map((bookmark) => {
      const category = bookmark.categoryId ? categories.get(bookmark.categoryId) : undefined;
      return {
        ...bookmark,
        categoryName: category?.name ?? null,
        sectionName: category?.sectionId ? (sections.get(category.sectionId) ?? null) : null,
      };
    });
  }

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

      const rows = resolveVocabulary(listBookmarksForExport(db, { datasetId, ...filters }));
      const exportedAt = Date.now();

      return unique.map((format) => ({
        filename: filenameFor(format),
        contentType: EXPORT_CONTENT_TYPES[format],
        content: serialize(format, rows, filters, exportedAt),
      }));
    },
  };
}
