import type { Database } from 'bun:sqlite';

import {
  assignTag,
  createCategory,
  createTag,
  getCategoryBySiblingName,
  upsertBookmarkByUrl,
} from '@al-yo-bo/db';
import type { ImportReport, ImportedBookmark } from '@al-yo-bo/shared';

export interface IngestOptions {
  file?: string;
  skipped?: number;
}

/**
 * Canonical map key for a category path. `JSON.stringify` (not a join) so a
 * category literally named `a/b` can never collide with the path
 * `["a", "b"]` — sibling-unique names make the tree the identity, and the key
 * must be injective over paths (MODEL.md principle 2).
 */
export function categoryPathKey(path: string[]): string {
  return JSON.stringify(path);
}

/**
 * Resolved vocabulary for a batch. Categories are keyed by ancestor path (a
 * name alone is ambiguous in a tree); tags by global name. Every path/tag the
 * batch references is covered unless it resolved to a non-active tag —
 * deprecated rows are never re-activated nor assigned (MODEL.md principle 3).
 */
export interface VocabularyResolution {
  /** `categoryPathKey(path)` → category id (the leaf of that path). */
  categoryIds: Map<string, string>;
  /** Tag name → tag id (active rows only). */
  tagIds: Map<string, string>;
  /** Tag names left unmapped because their existing row was not active. */
  skippedTags: string[];
  /** Categories actually inserted (not merged with an existing sibling). */
  categoriesCreated: number;
}

/** `ImportReport` plus the soft warnings surfaced during ingest. */
export interface IngestReport extends ImportReport {
  /** Non-fatal issues to surface in the UI. */
  warnings?: string[];
}

function uniquePaths(bookmarks: ImportedBookmark[]): string[][] {
  const seen = new Set<string>();
  const paths: string[][] = [];
  for (const bookmark of bookmarks) {
    if (bookmark.categoryPath.length === 0) {
      continue;
    }
    const key = categoryPathKey(bookmark.categoryPath);
    if (!seen.has(key)) {
      seen.add(key);
      paths.push(bookmark.categoryPath);
    }
  }
  return paths;
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
 * Resolves every category path and tag name in the batch against the single
 * workspace vocabulary, auto-creating anything missing (ARCHITECTURE §7
 * "Vocabulary establishment": the importer is the only vocabulary creator and
 * what it creates lands usable — categories as plain records, tags `active`).
 *
 * Path resolution walks `getCategoryBySiblingName` from the root, so
 * `["dev", "web", "2024"]` matches the sibling-unique tree (web/2024 and
 * books/2024 coexist) and shared prefixes across paths are resolved once.
 * Runs in one immediate transaction so a failure part-way cannot commit a
 * half-created vocabulary.
 */
export function resolveVocabulary(
  db: Database,
  bookmarks: ImportedBookmark[],
): VocabularyResolution {
  const resolution: VocabularyResolution = {
    categoryIds: new Map(),
    tagIds: new Map(),
    skippedTags: [],
    categoriesCreated: 0,
  };

  const run = db.transaction(() => {
    for (const path of uniquePaths(bookmarks)) {
      let parentId: string | null = null;
      const prefix: string[] = [];
      for (const name of path) {
        prefix.push(name);
        const key = categoryPathKey(prefix);
        let id = resolution.categoryIds.get(key);
        if (id === undefined) {
          const existing = getCategoryBySiblingName(db, parentId, name);
          if (existing) {
            id = existing.id;
          } else {
            // Auto-create as the last sibling (createCategory merges by
            // sibling name; the pre-check distinguishes "created" from
            // "merged" for the report count).
            id = createCategory(db, { name, parentId }).id;
            resolution.categoriesCreated += 1;
          }
          resolution.categoryIds.set(key, id);
        }
        parentId = id;
      }
    }

    for (const name of uniqueTagNames(bookmarks)) {
      const tag = createTag(db, { name });
      // createTag reuses an existing row regardless of status; re-importing a
      // previously deprecated tag must not re-activate it or assign it
      // (MODEL.md invariant: only active tags may be assigned to bookmarks).
      if (tag.status !== 'active') {
        resolution.skippedTags.push(name);
        continue;
      }
      resolution.tagIds.set(name, tag.id);
    }
  });
  run.immediate();

  return resolution;
}

/**
 * Commits a batch of bookmarks using a pre-resolved vocabulary. Upserts by the
 * globally unique URL (merge-by-URL, ARCHITECTURE §7 — re-importing the same
 * file never duplicates rows) and attaches frontmatter tags with
 * `source='import'` (user/import rows win over classifier re-runs). The
 * bookmark's category is the leaf of its resolved `categoryPath`; provenance
 * (`file`, `categoryPath`, `priority`) is preserved in `metadata.import` so
 * the exporter can re-emit priority stars.
 */
export function ingestBookmarks(
  db: Database,
  bookmarks: ImportedBookmark[],
  resolution: VocabularyResolution,
  options: IngestOptions = {},
): IngestReport {
  const report: IngestReport = {
    added: 0,
    updated: 0,
    skipped: options.skipped ?? 0,
    categoriesCreated: resolution.categoriesCreated,
    tagsAssigned: 0,
    parsed: bookmarks.length,
    bookmarks,
    addedIds: [],
  };

  const insideTransaction = db.transaction(() => {
    for (const entry of bookmarks) {
      const categoryId =
        entry.categoryPath.length === 0
          ? null
          : (resolution.categoryIds.get(categoryPathKey(entry.categoryPath)) ?? null);

      const metadata = {
        import: {
          file: options.file ?? null,
          categoryPath: entry.categoryPath,
          priority: entry.priority,
        },
      };

      const { bookmark, created } = upsertBookmarkByUrl(db, {
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

/**
 * One-shot commit (ARCHITECTURE §7 "single transaction"). Wraps vocabulary
 * resolution and the ingest pass inside one immediate transaction, so a
 * failure part-way through (a category path that conflicts, a tag insert
 * that violates a constraint) rolls back to the pre-import state instead of
 * leaving a half-created vocabulary behind a partial ingest.
 *
 * `resolveVocabulary` and `ingestBookmarks` remain exported for callers that
 * already hold a partial resolution they want to commit later; the import
 * service uses `commitImport` directly so the doc contract holds end-to-end.
 */
export function commitImport(
  db: Database,
  bookmarks: ImportedBookmark[],
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
    const resolution = resolveVocabularyInTransaction(db, bookmarks);
    ingestBookmarksInTransaction(db, bookmarks, resolution, report, options);
  });
  insideTransaction.immediate();
  return report;
}

/**
 * Variant of `resolveVocabulary` that runs inside a caller-provided
 * transaction; it does NOT call `run.immediate()` itself. Returns the same
 * shape so callers can chain it into their own transaction.
 */
function resolveVocabularyInTransaction(
  db: Database,
  bookmarks: ImportedBookmark[],
): VocabularyResolution {
  const resolution: VocabularyResolution = {
    categoryIds: new Map(),
    tagIds: new Map(),
    skippedTags: [],
    categoriesCreated: 0,
  };
  for (const path of uniquePaths(bookmarks)) {
    let parentId: string | null = null;
    const prefix: string[] = [];
    for (const name of path) {
      prefix.push(name);
      const key = categoryPathKey(prefix);
      let id = resolution.categoryIds.get(key);
      if (id === undefined) {
        const existing = getCategoryBySiblingName(db, parentId, name);
        if (existing) {
          id = existing.id;
        } else {
          // Auto-create as the last sibling (createCategory merges by
          // sibling name; the pre-check distinguishes "created" from
          // "merged" for the report count).
          id = createCategory(db, { name, parentId }).id;
          resolution.categoriesCreated += 1;
        }
        resolution.categoryIds.set(key, id);
      }
      parentId = id;
    }
  }
  for (const name of uniqueTagNames(bookmarks)) {
    const tag = createTag(db, { name });
    if (tag.status !== 'active') {
      resolution.skippedTags.push(name);
      continue;
    }
    resolution.tagIds.set(name, tag.id);
  }
  return resolution;
}

/**
 * Variant of `ingestBookmarks` that runs inside a caller-provided
 * transaction. Mutates the passed `IngestReport` (added/updated/
 * tagsAssigned/addedIds) and accumulates skipped-tag warnings on it so the
 * caller owns the report lifecycle.
 */
function ingestBookmarksInTransaction(
  db: Database,
  bookmarks: ImportedBookmark[],
  resolution: VocabularyResolution,
  report: IngestReport,
  options: IngestOptions,
): void {
  report.categoriesCreated = resolution.categoriesCreated;
  for (const entry of bookmarks) {
    const categoryId =
      entry.categoryPath.length === 0
        ? null
        : (resolution.categoryIds.get(categoryPathKey(entry.categoryPath)) ?? null);

    const metadata = {
      import: {
        file: options.file ?? null,
        categoryPath: entry.categoryPath,
        priority: entry.priority,
      },
    };

    const { bookmark, created } = upsertBookmarkByUrl(db, {
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

    for (const name of entry.tags) {
      const tagId = resolution.tagIds.get(name);
      if (!tagId) {
        continue;
      }
      assignTag(db, { bookmarkId: bookmark.id, tagId, source: 'import' });
      report.tagsAssigned += 1;
    }
  }
  if (resolution.skippedTags.length > 0) {
    report.warnings = resolution.skippedTags.map(
      (name) => `Deprecated tag "${name}" was not assigned to imported bookmarks.`,
    );
  }
}
