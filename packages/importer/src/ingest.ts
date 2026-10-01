import type { Database } from 'bun:sqlite';

import {
  assignTag,
  createCategory,
  createSection,
  createTag,
  getCategoryById,
  getCategoryByName,
  getSectionById,
  getTagById,
  upsertBookmarkByUrl,
} from '@al-yo-bo/db';
import {
  bytesToUuid,
  uuidToBytes,
  type Category,
  type ImportReport,
  type ImportedBookmark,
  type Section,
  type Tag,
  type VocabularyProposal,
} from '@al-yo-bo/shared';

export interface IngestOptions {
  file?: string;
  skipped?: number;
}

/**
 * Result of resolving a batch of bookmarks against a dataset's vocabulary.
 * Maps raw source names to entity ids; `proposals` lists the `proposed` entries
 * created for names that matched nothing active.
 */
export interface VocabularyResolution {
  sectionIds: Map<string, string>;
  categoryIds: Map<string, string>;
  tagIds: Map<string, string>;
  proposals: VocabularyProposal[];
}

function countRefs(
  bookmarks: ImportedBookmark[],
  pick: (bookmark: ImportedBookmark) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const bookmark of bookmarks) {
    const name = pick(bookmark);
    if (name) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Resolves every raw name in the batch against the dataset's vocabulary
 * (ARCHITECTURE §7 Stage 1): reuse `active` entries; follow `merged_into_id` for
 * `rejected` ones; create `proposed` entries for anything unmatched. Never
 * creates active vocabulary on demand.
 */
export function resolveVocabulary(
  db: Database,
  datasetId: string,
  bookmarks: ImportedBookmark[],
): VocabularyResolution {
  const resolution: VocabularyResolution = {
    sectionIds: new Map(),
    categoryIds: new Map(),
    tagIds: new Map(),
    proposals: [],
  };

  for (const [name, count] of countRefs(bookmarks, (b) => b.category)) {
    const section = resolveSection(db, datasetId, name);
    if (section) {
      resolution.sectionIds.set(name, section.id);
    } else {
      const proposed = db
        .query<{ id: Uint8Array }, [Uint8Array, string]>(
          `SELECT id FROM sections WHERE dataset_id = ? AND name = ?`,
        )
        .get(uuidToBytes(datasetId), name);
      resolution.proposals.push({
        kind: 'section',
        id: proposed ? bytesToUuid(proposed.id) : '',
        name,
        source: 'H2 heading',
        count,
      });
    }
  }

  for (const [name, count] of countRefs(bookmarks, (b) => b.subsection)) {
    const category = resolveCategory(db, datasetId, name);
    if (category) {
      resolution.categoryIds.set(name, category.id);
    } else {
      const proposed = db
        .query<{ id: Uint8Array }, [Uint8Array, string]>(
          `SELECT id FROM categories WHERE dataset_id = ? AND name = ?`,
        )
        .get(uuidToBytes(datasetId), name);
      resolution.proposals.push({
        kind: 'category',
        id: proposed ? bytesToUuid(proposed.id) : '',
        name,
        source: 'H3 heading',
        count,
      });
    }
  }

  const tagCounts = new Map<string, number>();
  for (const bookmark of bookmarks) {
    for (const name of bookmark.tags) {
      tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1);
    }
  }
  for (const [name, count] of tagCounts) {
    const tag = resolveTag(db, datasetId, name);
    if (tag) {
      resolution.tagIds.set(name, tag.id);
    } else {
      const proposed = db
        .query<{ id: Uint8Array }, [Uint8Array, string]>(
          `SELECT id FROM tags WHERE dataset_id = ? AND name = ? AND category_id IS NULL`,
        )
        .get(uuidToBytes(datasetId), name);
      resolution.proposals.push({
        kind: 'tag',
        id: proposed ? bytesToUuid(proposed.id) : '',
        name,
        source: 'frontmatter tags',
        count,
      });
    }
  }

  return resolution;
}

/**
 * Resolves a raw section name: an `active` section by name, the target of a
 * `rejected` section's merge, or a new `proposed` section (returns null when
 * the name is new or was rejected outright — the caller records the proposal).
 */
function resolveSection(db: Database, datasetId: string, name: string): Section | null {
  const active = db
    .query<{ id: Uint8Array }, [Uint8Array, string]>(
      `SELECT id FROM sections WHERE dataset_id = ? AND name = ? AND status = 'active'`,
    )
    .get(uuidToBytes(datasetId), name);
  if (active) {
    return getSectionById(db, bytesToUuid(active.id));
  }
  const rejected = db
    .query<{ id: Uint8Array; merged_into_id: Uint8Array | null }, [Uint8Array, string]>(
      `SELECT id, merged_into_id FROM sections WHERE dataset_id = ? AND name = ?`,
    )
    .get(uuidToBytes(datasetId), name);
  if (rejected?.merged_into_id) {
    return getSectionById(db, bytesToUuid(rejected.merged_into_id));
  }
  if (rejected) {
    return null; // rejected outright: silently skip
  }
  createSection(db, { datasetId, name, status: 'proposed' });
  return null; // proposed: the caller records the proposal
}

/**
 * Resolves a raw category name: an `active` category by name, the target of a
 * `rejected` category's merge, or a new `proposed` category (returns null when
 * the name is new or was rejected outright — the caller records the proposal).
 */
function resolveCategory(db: Database, datasetId: string, name: string): Category | null {
  const active = db
    .query<{ id: Uint8Array }, [Uint8Array, string]>(
      `SELECT id FROM categories WHERE dataset_id = ? AND name = ? AND status = 'active'`,
    )
    .get(uuidToBytes(datasetId), name);
  if (active) {
    return getCategoryById(db, bytesToUuid(active.id));
  }
  const rejected = db
    .query<{ id: Uint8Array; merged_into_id: Uint8Array | null }, [Uint8Array, string]>(
      `SELECT id, merged_into_id FROM categories WHERE dataset_id = ? AND name = ?`,
    )
    .get(uuidToBytes(datasetId), name);
  if (rejected?.merged_into_id) {
    return getCategoryById(db, bytesToUuid(rejected.merged_into_id));
  }
  if (rejected) {
    return null; // rejected outright: silently skip
  }
  createCategory(db, { datasetId, name, status: 'proposed' });
  return null; // proposed: the caller records the proposal
}

/**
 * Resolves a raw tag name: an `active` unscoped tag by name, the target of a
 * `rejected` tag's merge, or a new `proposed` tag (returns null when the name
 * is new or was rejected outright — the caller records the proposal).
 */
function resolveTag(db: Database, datasetId: string, name: string): Tag | null {
  const active = db
    .query<{ id: Uint8Array }, [Uint8Array, string]>(
      `SELECT id FROM tags WHERE dataset_id = ? AND name = ? AND category_id IS NULL AND status = 'active'`,
    )
    .get(uuidToBytes(datasetId), name);
  if (active) {
    return getTagById(db, bytesToUuid(active.id));
  }
  const rejected = db
    .query<{ id: Uint8Array; merged_into_id: Uint8Array | null }, [Uint8Array, string]>(
      `SELECT id, merged_into_id FROM tags WHERE dataset_id = ? AND name = ? AND category_id IS NULL`,
    )
    .get(uuidToBytes(datasetId), name);
  if (rejected?.merged_into_id) {
    return getTagById(db, bytesToUuid(rejected.merged_into_id));
  }
  if (rejected) {
    return null; // rejected outright: silently skip
  }
  createTag(db, { datasetId, name, status: 'proposed' });
  return null; // proposed: the caller records the proposal
}

/**
 * Commits a batch of bookmarks using a pre-resolved vocabulary (the resolution
 * must already be complete — no pending proposals for the names used here).
 * Upserts bookmarks by URL and attaches resolved frontmatter tags. The bookmark's
 * category is the resolved H3 category, or the section's catch-all category when
 * the file had no H3 under that H2.
 */
export function ingestBookmarks(
  db: Database,
  datasetId: string,
  bookmarks: ImportedBookmark[],
  resolution: VocabularyResolution,
  options: IngestOptions = {},
): ImportReport {
  const report: ImportReport = {
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
      // H2 -> section; H3 -> category. A bookmark under an H2 with no H3 sits in
      // the section's catch-all category (same name as the section) when one
      // exists, so section membership is recoverable from the category.
      let categoryId: string | null = null;
      if (entry.subsection) {
        categoryId = resolution.categoryIds.get(entry.subsection) ?? null;
      } else if (entry.category) {
        const sectionId = resolution.sectionIds.get(entry.category);
        if (sectionId) {
          const section = getSectionById(db, sectionId);
          if (section) {
            const catchAll = getCategoryByName(db, datasetId, section.name);
            categoryId = catchAll?.id ?? null;
          }
        }
      }

      const metadata = {
        import: {
          file: options.file ?? null,
          section: entry.category,
          subsection: entry.subsection,
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
  return report;
}
