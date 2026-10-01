import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import { uuidToBytes } from '@al-yo-bo/shared';

import {
  assignTag,
  clearDatasetContent,
  createBookmark,
  createCategory,
  createClassificationResult,
  createClassificationRun,
  createDataset,
  createImportBatch,
  createSection,
  createTag,
  getDatasetByName,
  getEmbedding,
  keywordSearch,
  listBookmarks,
  listCategories,
  listSections,
  listStagedBatches,
  listTags,
  openDatabase,
  setupDatabase,
  upsertEmbedding,
} from '../src/index.ts';

function freshDb(): Database {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  return db;
}

interface Populated {
  bookmarkId: string;
}

/** Populates a dataset with one of everything clearDatasetContent must remove. */
function populate(db: Database, datasetId: string, slug: string): Populated {
  const section = createSection(db, { datasetId, name: `Section ${slug}` });
  const category = createCategory(db, {
    datasetId,
    name: `Category ${slug}`,
    sectionId: section.id,
  });
  const tag = createTag(db, { datasetId, name: `tag-${slug}`, categoryId: category.id });
  const bookmark = createBookmark(db, {
    datasetId,
    url: `https://wipe.test/${slug}`,
    title: `Wipe ${slug}`,
    content: `body ${slug}`,
    categoryId: category.id,
  });
  assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'import' });

  const runId = createClassificationRun(db, { bookmarkId: bookmark.id, classifier: 'ollaya' });
  createClassificationResult(db, { runId, tagId: tag.id, probability: 0.9, selected: true });
  upsertEmbedding(db, {
    bookmarkId: bookmark.id,
    model: 'test-model',
    dims: 1,
    embedding: new Uint8Array([0, 0, 0, 0]),
  });
  createImportBatch(db, { datasetId, file: 'collection.md', bookmarks: [] });

  return { bookmarkId: bookmark.id };
}

describe('clearDatasetContent', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('removes a dataset content while keeping the dataset row and other datasets', () => {
    const wipe = createDataset(db, 'wipe');
    const keep = createDataset(db, 'keep');
    const wiped = populate(db, wipe.id, 'wipe');
    populate(db, keep.id, 'keep');

    const report = clearDatasetContent(db, wipe.id);

    expect(report).toEqual({ bookmarks: 1, importBatches: 1, tags: 1, categories: 1, sections: 1 });

    // Dataset row survives so the name can be reused for a fresh import.
    expect(getDatasetByName(db, 'wipe')).not.toBeNull();

    // Nothing scoped to the wiped dataset remains.
    expect(listBookmarks(db, { datasetId: wipe.id }).total).toBe(0);
    expect(listTags(db, wipe.id)).toHaveLength(0);
    expect(listCategories(db, wipe.id)).toHaveLength(0);
    expect(listSections(db, wipe.id)).toHaveLength(0);
    expect(listStagedBatches(db, wipe.id)).toHaveLength(0);
    expect(keywordSearch(db, { q: 'body', datasetId: wipe.id })).toHaveLength(0);

    // Child rows cascade away with the bookmark.
    expect(getEmbedding(db, wiped.bookmarkId)).toBeNull();
    const bookmarkBytes = uuidToBytes(wiped.bookmarkId);
    const runs = db
      .query<{ n: number }, [Uint8Array]>(
        'SELECT COUNT(*) AS n FROM classification_runs WHERE bookmark_id = ?',
      )
      .get(bookmarkBytes);
    const assignments = db
      .query<{ n: number }, [Uint8Array]>(
        'SELECT COUNT(*) AS n FROM bookmark_tags WHERE bookmark_id = ?',
      )
      .get(bookmarkBytes);
    expect(runs?.n).toBe(0);
    expect(assignments?.n).toBe(0);

    // The untouched dataset is intact.
    expect(listBookmarks(db, { datasetId: keep.id }).total).toBe(1);
    expect(listTags(db, keep.id)).toHaveLength(1);
    expect(listCategories(db, keep.id)).toHaveLength(1);
    expect(listSections(db, keep.id)).toHaveLength(1);
  });

  test('is a no-op report for a dataset with no content', () => {
    const empty = createDataset(db, 'empty');
    expect(clearDatasetContent(db, empty.id)).toEqual({
      bookmarks: 0,
      importBatches: 0,
      tags: 0,
      categories: 0,
      sections: 0,
    });
  });
});
