import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bytesToUuid, newIdBytes, uuidToBytes } from '@al-yo-bo/shared';

import {
  assignTag,
  createDataset,
  createBookmark,
  createCategory,
  createClassificationRun,
  createTag,
  createUnknownClassificationLabel,
  deleteBookmark,
  deleteCategory,
  getAggregates,
  getBookmarkById,
  getBookmarksWithTagsByIds,
  getBookmarkStatuses,
  getBookmarkTags,
  getCategoryById,
  getDatasetByName,
  keywordSearch,
  listBookmarkIdsMissingContent,
  listBookmarkIdsMissingEmbeddings,
  listBookmarks,
  listUnknownClassificationLabels,
  DEFAULT_SEED_PATH,
  listEmbeddingModelMismatches,
  migrate,
  openDatabase,
  resetSeedData,
  resolveSeedDataset,
  seedFromFile,
  setupDatabase,
  UnknownSeedDatasetError,
  updateBookmark,
  upsertEmbedding,
} from '../src/index.ts';

function freshDb(): Database & { datasetId: string } {
  const db = openDatabase(':memory:') as Database & { datasetId: string };
  setupDatabase(db);
  db.datasetId = createDataset(db, 'test').id;
  return db;
}

describe('schema & triggers', () => {
  let db: Database & { datasetId: string };
  beforeEach(() => {
    db = freshDb();
  });

  test('forces server timestamps on insert, overriding client values', () => {
    const id = newIdBytes();
    db.query('INSERT INTO categories (id, dataset_id, name, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      uuidToBytes(db.datasetId),
      'x',
      1,
    );
    const category = getCategoryById(db, bytesToUuid(id));
    expect(category).not.toBeNull();
    expect(category?.createdAt).toBeGreaterThan(1_000_000_000_000);
  });

  test('keeps the FTS index in sync across insert, update and delete', () => {
    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      title: 'Hello world',
    });
    expect(keywordSearch(db, { q: 'hello' }).length).toBe(1);

    updateBookmark(db, bookmark.id, { title: 'Goodbye moon' });
    expect(keywordSearch(db, { q: 'hello' }).length).toBe(0);
    expect(keywordSearch(db, { q: 'moon' }).length).toBe(1);

    deleteBookmark(db, bookmark.id);
    expect(keywordSearch(db, { q: 'moon' }).length).toBe(0);
  });

  test('deleting a category nulls the bookmark reference instead of cascading', () => {
    const category = createCategory(db, { datasetId: db.datasetId, name: 'Alpha' });
    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/b',
      categoryId: category.id,
    });
    deleteCategory(db, category.id);
    expect(getBookmarkById(db, bookmark.id)?.categoryId).toBeNull();
  });

  test('applies the bookmark status migration with defaults', () => {
    const versions = db
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version);
    expect(versions).toContain('0002_bookmark_status.sql');

    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/status-defaults',
    });
    expect(bookmark.status).toBe('active');
    expect(bookmark.scrapeAttempts).toBe(0);
  });
});

describe('bookmark status', () => {
  let db: Database & { datasetId: string };
  beforeEach(() => {
    db = freshDb();
  });

  function createStatusFixtures(): void {
    createBookmark(db, { datasetId: db.datasetId, url: 'https://s-active.test', title: 'keep me' });
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://s-invalid.test',
      title: 'keep me too',
      status: 'invalid',
      scrapeAttempts: 3,
    });
  }

  test('listBookmarks treats undefined status as unfiltered and honors explicit statuses', () => {
    createStatusFixtures();

    expect(listBookmarks(db).total).toBe(2);
    expect(listBookmarks(db, { status: 'active' }).total).toBe(1);
    expect(listBookmarks(db, { status: 'active' }).items[0]?.url).toBe('https://s-active.test/');
    expect(listBookmarks(db, { status: 'invalid' }).items[0]?.url).toBe('https://s-invalid.test/');
    expect(listBookmarks(db, { status: 'all' }).total).toBe(2);
  });

  test('keywordSearch excludes invalid bookmarks when filtered to active', () => {
    createStatusFixtures();

    expect(keywordSearch(db, { q: 'keep', status: 'active' }).length).toBe(1);
    expect(keywordSearch(db, { q: 'keep', status: 'all' }).length).toBe(2);
  });

  test('reconciliation queries exclude invalid bookmarks', () => {
    const active = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://r-active.test',
      content: 'body',
    });
    const invalid = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://r-invalid.test',
      content: 'body',
      status: 'invalid',
      scrapeAttempts: 3,
    });

    expect(listBookmarkIdsMissingContent(db)).toEqual([active.id]);
    expect(listBookmarkIdsMissingEmbeddings(db)).toEqual([active.id]);

    upsertEmbedding(db, {
      bookmarkId: active.id,
      model: 'stale-model',
      dims: 1,
      embedding: new Uint8Array([0, 0, 0, 0]),
    });
    upsertEmbedding(db, {
      bookmarkId: invalid.id,
      model: 'stale-model',
      dims: 1,
      embedding: new Uint8Array([0, 0, 0, 0]),
    });
    expect(listEmbeddingModelMismatches(db, 'current-model')).toEqual([active.id]);
  });

  test('aggregates report the invalid bookmark count', () => {
    createStatusFixtures();

    const aggregates = getAggregates(db, db.datasetId);
    expect(aggregates.total).toBe(2);
    expect(aggregates.invalidCount).toBe(1);
  });

  test('getBookmarkStatuses batches id → status lookups', () => {
    const active = createBookmark(db, { datasetId: db.datasetId, url: 'https://bs-active.test' });
    const invalid = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://bs-invalid.test',
      status: 'invalid',
      scrapeAttempts: 3,
    });
    const unknown = '00000000-0000-0000-0000-000000000000';

    const statuses = getBookmarkStatuses(db, [active.id, invalid.id, unknown]);
    expect(statuses.get(active.id)).toBe('active');
    expect(statuses.get(invalid.id)).toBe('invalid');
    expect(statuses.has(unknown)).toBe(false);
    expect(getBookmarkStatuses(db, []).size).toBe(0);
  });

  test('IN-list lookups chunk past SQLite host-parameter limits', () => {
    // 1200 ids exceeds SQLite's default host-parameter limit (999), so an
    // unchunked IN (...) would throw "too many SQL variables".
    const ids: string[] = [];
    db.transaction(() => {
      const insert = db.query(
        'INSERT INTO bookmarks (id, dataset_id, url, title, status) VALUES (?, ?, ?, ?, ?)',
      );
      for (let i = 0; i < 1200; i++) {
        const id = newIdBytes();
        insert.run(
          id,
          uuidToBytes(db.datasetId),
          `https://chunk.test/${i}`,
          `Chunk ${i}`,
          'active',
        );
        ids.push(bytesToUuid(id));
      }
    }).immediate();

    const unknown = '00000000-0000-0000-0000-000000000000';
    const statuses = getBookmarkStatuses(db, [...ids, unknown]);
    expect(statuses.size).toBe(1200);
    expect(statuses.get(ids[0]!)).toBe('active');
    expect(statuses.has(unknown)).toBe(false);

    const hydrated = getBookmarksWithTagsByIds(db, ids);
    expect(hydrated).toHaveLength(1200);
    expect(hydrated[0]!.id).toBe(ids[0]!);
    expect(hydrated[1199]!.id).toBe(ids[1199]!);
  });
});

describe('tag assignments', () => {
  let db: Database & { datasetId: string };
  beforeEach(() => {
    db = freshDb();
  });

  test('classifier assignments never overwrite user assignments', () => {
    const bookmark = createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/c' });
    const tag = createTag(db, { datasetId: db.datasetId, name: 'frontend' });

    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });
    assignTag(db, {
      bookmarkId: bookmark.id,
      tagId: tag.id,
      source: 'classifier',
      confidence: 0.9,
    });

    const [assignment] = getBookmarkTags(db, bookmark.id);
    expect(assignment?.source).toBe('user');
  });

  test('classifier assignments do update classifier-sourced rows', () => {
    const bookmark = createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/d' });
    const tag = createTag(db, { datasetId: db.datasetId, name: 'backend' });

    assignTag(db, {
      bookmarkId: bookmark.id,
      tagId: tag.id,
      source: 'classifier',
      confidence: 0.5,
    });
    assignTag(db, {
      bookmarkId: bookmark.id,
      tagId: tag.id,
      source: 'classifier',
      confidence: 0.8,
    });

    const [assignment] = getBookmarkTags(db, bookmark.id);
    expect(assignment?.confidence).toBe(0.8);
  });
});

describe('unknown classification labels', () => {
  let db: Database & { datasetId: string };
  beforeEach(() => {
    db = freshDb();
  });

  test('persists immutable evidence rows with server timestamps', () => {
    const versions = db
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version);
    expect(versions).toContain('0006_unknown_classification_labels.sql');

    const bookmark = createBookmark(db, { datasetId: db.datasetId, url: 'https://ucl.test' });
    const runId = createClassificationRun(db, { bookmarkId: bookmark.id, classifier: 'ollaya' });

    createUnknownClassificationLabel(db, { runId, rawLabel: 'mystery', probability: 0.99 });
    createUnknownClassificationLabel(db, { runId, rawLabel: 'mystery', probability: 0.4 });

    const rows = listUnknownClassificationLabels(db, runId);
    expect(rows).toHaveLength(2); // no uniqueness constraint — each occurrence kept
    expect(rows[0]).toMatchObject({ rawLabel: 'mystery', probability: 0.99 });
    expect(rows[1]?.probability).toBe(0.4);
    expect(rows[0]?.createdAt).toBeGreaterThan(1_000_000_000_000); // trigger forced server time
  });

  test('cascades away with the classification run', () => {
    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://ucl-cascade.test',
    });
    const runId = createClassificationRun(db, { bookmarkId: bookmark.id, classifier: 'ollaya' });
    createUnknownClassificationLabel(db, { runId, rawLabel: 'mystery', probability: 0.9 });

    db.query('DELETE FROM classification_runs WHERE id = ?').run(uuidToBytes(runId));
    expect(listUnknownClassificationLabels(db, runId)).toEqual([]);
  });
});

describe('listing & aggregates', () => {
  let db: Database & { datasetId: string };
  beforeEach(() => {
    db = freshDb();
  });

  test('filters by category and paginates', () => {
    const category = createCategory(db, { datasetId: db.datasetId, name: 'Tools' });
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://a.test',
      title: 'A',
      categoryId: category.id,
    });
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://b.test',
      title: 'B',
      categoryId: category.id,
    });
    createBookmark(db, { datasetId: db.datasetId, url: 'https://c.test', title: 'C' });

    const page = listBookmarks(db, { categoryId: category.id, limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items.length).toBe(1);

    const aggregates = getAggregates(db, db.datasetId);
    expect(aggregates.total).toBe(3);
    expect(aggregates.categories.find((c) => c.id === category.id)?.count).toBe(2);
  });
});

describe('bookmark image projection', () => {
  let db: Database & { datasetId: string };
  beforeEach(() => {
    db = freshDb();
  });

  // Regression: the UI's screenshot -> og:image -> placeholder chain reads
  // `bookmark.image`, so every hydrated read path must project metadata.image.
  test('projects metadata.image onto list and by-ids reads', () => {
    const image = {
      ogImageUrl: 'https://img.test/og.png',
      screenshotPath: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa.jpg',
    };
    const created = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://img.test',
      title: 'With image',
      metadata: { image },
    });

    expect(listBookmarks(db).items[0]?.image).toEqual(image);
    expect(getBookmarksWithTagsByIds(db, [created.id])[0]?.image).toEqual(image);
  });

  test('falls back to a both-null image when metadata has none', () => {
    createBookmark(db, { datasetId: db.datasetId, url: 'https://plain.test' });
    expect(listBookmarks(db).items[0]?.image).toEqual({ ogImageUrl: null, screenshotPath: null });
  });
});

describe('seed fixture', () => {
  test('loads the synthetic demo dataset and is idempotent', () => {
    const db = freshDb();
    const grimoire = resolveSeedDataset('grimoire');

    const first = seedFromFile(db, grimoire);
    expect(first.bookmarksAdded).toBe(23);
    expect(first.categoriesCreated).toBe(8);
    expect(first.tagsCreated).toBe(51);
    expect(first.assignments).toBeGreaterThan(0);

    const second = seedFromFile(db, grimoire);
    expect(second.bookmarksAdded).toBe(0);
    expect(second.bookmarksUpdated).toBe(23);
    expect(second.categoriesCreated).toBe(0);
    expect(second.tagsCreated).toBe(0);

    const grimoireId = getDatasetByName(db, 'grimoire')!.id;
    const aggregates = getAggregates(db, grimoireId);
    expect(aggregates.total).toBe(23);
    expect(keywordSearch(db, { q: 'sqlite', datasetId: grimoireId }).length).toBeGreaterThan(0);
  });

  test('loads the leo dataset from the default path', () => {
    const db = freshDb();

    const report = seedFromFile(db);
    expect(report.bookmarksAdded).toBe(212);
    expect(report.categoriesCreated).toBe(40);
    expect(report.tagsCreated).toBe(1);
    expect(report.assignments).toBe(114);
    expect(getAggregates(db, getDatasetByName(db, 'leo')!.id).total).toBe(212);
  });

  test('resolves the leo dataset by default and both datasets by name', () => {
    expect(DEFAULT_SEED_PATH).toContain('seeds/datasets/leo.seed.json');
    expect(resolveSeedDataset('leo')).toBe(DEFAULT_SEED_PATH);
    expect(resolveSeedDataset('grimoire')).toContain('seeds/datasets/grimoire.seed.json');
  });

  test('rejects unknown dataset names with the available list', () => {
    expect(() => resolveSeedDataset('nope')).toThrow(UnknownSeedDatasetError);
    expect(() => resolveSeedDataset('nope')).toThrow(/Available datasets: leo, grimoire/);
  });

  test('reset wipes content so a re-seed starts clean', () => {
    const db = freshDb();
    const grimoire = resolveSeedDataset('grimoire');

    seedFromFile(db, grimoire);
    const grimoireId = getDatasetByName(db, 'grimoire')!.id;
    expect(getAggregates(db, grimoireId).total).toBe(23);

    // A stale bookmark outside the dataset proves the reset, not the upsert,
    // produced the post-reset state.
    const stray = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://stray.example/only',
      title: 'Stray',
    });
    expect(getAggregates(db, grimoireId).total).toBe(23);
    expect(getAggregates(db, db.datasetId).total).toBe(1);

    resetSeedData(db);
    expect(getAggregates(db, grimoireId).total).toBe(0);
    expect(getBookmarkById(db, stray.id)).toBeNull();
    // The FTS delete trigger must have fired for the wiped rows too.
    expect(keywordSearch(db, { q: 'Stray' })).toHaveLength(0);

    const report = seedFromFile(db, grimoire);
    expect(report.bookmarksAdded).toBe(23);
    expect(report.bookmarksUpdated).toBe(0);
    expect(getAggregates(db, grimoireId).total).toBe(23);
    expect(keywordSearch(db, { q: 'sqlite', datasetId: grimoireId }).length).toBeGreaterThan(0);
  });
});

describe('keyword search snippets', () => {
  let db: Database & { datasetId: string };
  beforeEach(() => {
    db = freshDb();
  });

  test('a content-only match returns a snippet drawn from content', () => {
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/content-snippet',
      title: 'Totally Unrelated Title',
      content: 'The quick brown fox jumps over the lazy dog and drinks from the river bank',
    });

    const [hit] = keywordSearch(db, { q: 'river' });
    expect(hit?.snippet).toContain('river');
    expect(hit?.snippet).toContain('[river]');
  });

  test('a title-only match falls back to the title', () => {
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/title-fallback',
      title: 'Rust async guide',
    });

    const [hit] = keywordSearch(db, { q: 'async' });
    expect(hit?.snippet).toBe('Rust async guide');
  });
});

describe('orphan evidence cleanup migration', () => {
  test('0005 deletes bookmark_tags and classification_results rows pointing at dropped tags', () => {
    // Apply only the migrations that precede 0005, then plant orphan evidence
    // rows the way 0004 left them (FKs disabled while it dropped rejected tags).
    const migrationsDir = join(import.meta.dir, '../migrations');
    const preDir = mkdtempSync(join(tmpdir(), 'al-yo-bo-migrations-'));
    for (const file of readdirSync(migrationsDir).filter(
      (f) => f.endsWith('.sql') && f < '0005_',
    )) {
      writeFileSync(join(preDir, file), readFileSync(join(migrationsDir, file)));
    }

    const db = openDatabase(':memory:');
    migrate(db, preDir);

    const datasetId = createDataset(db, 'orphans').id;
    const bookmark = createBookmark(db, { datasetId, url: 'https://example.com/orphan' });
    const tag = createTag(db, { datasetId, name: 'survivor' });
    const runId = newIdBytes();
    db.query('INSERT INTO classification_runs (id, bookmark_id, classifier) VALUES (?, ?, ?)').run(
      runId,
      uuidToBytes(bookmark.id),
      'test',
    );

    const orphanTagId = newIdBytes();
    // PRAGMA foreign_keys is a no-op inside a transaction (see src/migrations.ts),
    // so the orphan fixtures are planted with bare statements, not wrapped.
    db.exec('PRAGMA foreign_keys = OFF');
    db.query('INSERT INTO bookmark_tags (id, bookmark_id, tag_id, source) VALUES (?, ?, ?, ?)').run(
      newIdBytes(),
      uuidToBytes(bookmark.id),
      orphanTagId,
      'user',
    );
    db.query(
      'INSERT INTO classification_results (id, run_id, tag_id, probability) VALUES (?, ?, ?, ?)',
    ).run(newIdBytes(), runId, orphanTagId, 0.9);
    // Valid rows sharing the same tables must survive the cleanup.
    db.query('INSERT INTO bookmark_tags (id, bookmark_id, tag_id, source) VALUES (?, ?, ?, ?)').run(
      newIdBytes(),
      uuidToBytes(bookmark.id),
      uuidToBytes(tag.id),
      'user',
    );
    db.query(
      'INSERT INTO classification_results (id, run_id, tag_id, probability) VALUES (?, ?, ?, ?)',
    ).run(newIdBytes(), runId, uuidToBytes(tag.id), 0.5);
    db.exec('PRAGMA foreign_keys = ON');

    const applied = setupDatabase(db);
    expect(applied).toContain('0005_orphan_evidence_cleanup.sql');

    expect(db.query('SELECT COUNT(*) AS count FROM bookmark_tags').get()).toEqual({ count: 1 });
    expect(db.query('SELECT COUNT(*) AS count FROM classification_results').get()).toEqual({
      count: 1,
    });
  });
});
