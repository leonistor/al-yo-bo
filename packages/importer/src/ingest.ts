import type { Database } from 'bun:sqlite';

import {
  assignTag,
  createCategory,
  createTag,
  getCategoryByName,
  upsertBookmarkByUrl,
} from '@al-yo-bo/db';
import type { ImportReport, ImportedBookmark } from '@al-yo-bo/shared';

export interface IngestOptions {
  file?: string;
  skipped?: number;
}

/**
 * Resolved vocabulary for a batch. Maps raw source names to entity ids; every
 * name in the batch is covered by a map entry unless it resolved to a
 * non-active tag (deprecated rows are never assigned — MODEL.md invariant),
 * in which case the name is reported in `skippedTags`.
 */
export interface VocabularyResolution {
  /** Name → category id (active rows only). */
  categoryIds: Map<string, string>;
  /** Name → tag id (active rows only). */
  tagIds: Map<string, string>;
  /** Tag names left unmapped because their existing row was not active. */
  skippedTags: string[];
}

/** `ImportReport` plus the soft warnings surfaced during ingest. */
export interface IngestReport extends ImportReport {
  /** Non-fatal issues to surface in the UI, mirroring `ExtractionResult.warnings`. */
  warnings?: string[];
}

function uniqueNames(
  bookmarks: ImportedBookmark[],
  pick: (bookmark: ImportedBookmark) => string | null,
): string[] {
  const seen = new Set<string>();
  for (const bookmark of bookmarks) {
    const name = pick(bookmark);
    if (name) {
      seen.add(name);
    }
  }
  return [...seen];
}

function uniqueTagNames(bookmarks: ImportedBookmark[]): string[] {
  const seen = new Set<string>();
  for (const bookmark of bookmarks) {
    for (const name of bookmark.tags) {
      seen.add(name);
    }
  }
  return [...seen];
}

/**
 * Resolves every raw name in the batch against the dataset's vocabulary and
 * auto-creates any missing category or tag as active (Phase 0 simplification:
 * no `proposed` lifecycle, no staging). Returns id maps the ingest step
 * consumes directly.
 */
export function resolveVocabulary(
  db: Database,
  datasetId: string,
  bookmarks: ImportedBookmark[],
): VocabularyResolution {
  const resolution: VocabularyResolution = {
    categoryIds: new Map(),
    tagIds: new Map(),
    skippedTags: [],
  };

  for (const name of uniqueNames(bookmarks, (b) => b.category)) {
    const category =
      getCategoryByName(db, datasetId, name) ??
      createCategory(db, { datasetId, name });
    resolution.categoryIds.set(name, category.id);
  }

  for (const name of uniqueTagNames(bookmarks)) {
    const tag = createTag(db, { datasetId, name });
    // createTag reuses an existing row regardless of status; re-importing a
    // previously deprecated tag must not re-activate it or assign it
    // (MODEL.md invariant: only active tags may be assigned to bookmarks).
    if (tag.status !== 'active') {
      resolution.skippedTags.push(name);
      continue;
    }
    resolution.tagIds.set(name, tag.id);
  }

  return resolution;
}

/**
 * Commits a batch of bookmarks using a pre-resolved vocabulary. Upserts
 * bookmarks by URL and attaches frontmatter tags. The bookmark's category is
 * the resolved `category` name from the source; sections are no longer
 * surfaced as a separate import field.
 */
export function ingestBookmarks(
  db: Database,
  datasetId: string,
  bookmarks: ImportedBookmark[],
  resolution: VocabularyResolution,
  options: IngestOptions = {},
): IngestReport {
  const report: IngestReport = {
    added: 0,
    updated: 0,
    skipped: options.skipped ?? 0,
    categoriesCreated: 0,
    tagsAssigned: 0,
    parsed: bookmarks.length,
    bookmarks,
    addedIds: [],
  };

  const insideTransaction = db.transaction(() => {
    for (const entry of bookmarks) {
      const categoryId = entry.category
        ? (resolution.categoryIds.get(entry.category) ?? null)
        : null;

      const metadata = {
        import: {
          file: options.file ?? null,
          category: entry.category,
          priority: entry.priority,
        },
      };

      const { bookmark, created } = upsertBookmarkByUrl(db, {
        datasetId,
        url: entry.url,
        title: entry.title,
        description: entry.description,
        categoryId,
        metadata,
      });

      if (created) {
        report.added += 1;
        report.addedIds.push(bookmark.id);
      } else {
        report.updated += 1;
      }

      // Frontmatter tags attach only to tags resolved by the vocabulary pass.
      for (const name of entry.tags) {
        const tagId = resolution.tagIds.get(name);
        if (!tagId) {
          continue;
        }
        assignTag(db, { bookmarkId: bookmark.id, tagId, source: 'import' });
        report.tagsAssigned += 1;
      }
    }
  });

  insideTransaction.immediate();
  if (resolution.skippedTags.length > 0) {
    report.warnings = resolution.skippedTags.map(
      (name) => `Deprecated tag "${name}" was not assigned to imported bookmarks.`,
    );
  }
  return report;
}
