import { describe, expect, test } from 'bun:test';

import {
  assignTag,
  createBookmark,
  createCategory,
  createDataset,
  createTag,
  setTagStatus,
} from '@al-yo-bo/db';

import { ConflictError, NotFoundError, ValidationError } from '../src/errors.ts';
import { createVocabularyService } from '../src/services/vocabulary.ts';
import { createVectorProvider } from '../src/vector/provider.ts';
import { StubVectorIndex, makeDb, recordingJobs } from './support.ts';

function makeService(vector = new StubVectorIndex()) {
  const db = makeDb();
  const jobs = recordingJobs();
  const service = createVocabularyService({
    db,
    jobs,
    vector: createVectorProvider(vector, 'memory'),
    datasetId: db.datasetId,
  });
  return { db, jobs, vector, service };
}

describe('VocabularyService — dataset boundary', () => {
  test('createTag and updateTag reject a category from another dataset', () => {
    const { db, service } = makeService();
    const other = createDataset(db, 'other');
    const foreignCategory = createCategory(db, { datasetId: other.id, name: 'Foreign' });

    expect(() => service.createTag({ name: 'leaky', categoryId: foreignCategory.id })).toThrow(
      ValidationError,
    );

    const tag = createTag(db, { datasetId: db.datasetId, name: 'scoped' });
    expect(() => service.updateTag(tag.id, { categoryId: foreignCategory.id })).toThrow(
      ValidationError,
    );
  });
});

describe('VocabularyService — duplicate names', () => {
  test('creating a duplicate section/category/tag throws ConflictError', () => {
    const { service } = makeService();

    service.createSection({ name: 'Guides' });
    expect(() => service.createSection({ name: 'Guides' })).toThrow(ConflictError);

    service.createCategory({ name: 'Dev' });
    expect(() => service.createCategory({ name: 'Dev' })).toThrow(ConflictError);

    service.createTag({ name: 'rust' });
    expect(() => service.createTag({ name: 'rust' })).toThrow(ConflictError);
  });

  test('tag duplicates are scoped per (dataset, category)', () => {
    const { service } = makeService();
    const category = service.createCategory({ name: 'Dev' });

    service.createTag({ name: 'rust', categoryId: category.id });
    expect(() => service.createTag({ name: 'rust', categoryId: category.id })).toThrow(
      ConflictError,
    );
    // Unscoped is a different scope, so the same name is allowed there.
    expect(service.createTag({ name: 'rust' }).name).toBe('rust');
  });
});

describe('VocabularyService — rename collisions', () => {
  test('section rename onto an existing name conflicts; own name succeeds', () => {
    const { service } = makeService();
    const a = service.createSection({ name: 'A' });
    const b = service.createSection({ name: 'B' });

    expect(() => service.updateSection(b.id, { name: 'A' })).toThrow(ConflictError);
    expect(service.updateSection(a.id, { name: 'A' }).name).toBe('A');
  });

  test('category rename onto an existing name conflicts; own name succeeds', () => {
    const { service } = makeService();
    const a = service.createCategory({ name: 'A' });
    const b = service.createCategory({ name: 'B' });

    expect(() => service.updateCategory(b.id, { name: 'A' })).toThrow(ConflictError);
    expect(service.updateCategory(a.id, { name: 'A' }).name).toBe('A');
  });

  test('tag rename onto an existing name in its scope conflicts; own name succeeds', () => {
    const { service } = makeService();
    const a = service.createTag({ name: 'A' });
    const b = service.createTag({ name: 'B' });

    expect(() => service.updateTag(b.id, { name: 'A' })).toThrow(ConflictError);
    expect(service.updateTag(a.id, { name: 'A' }).name).toBe('A');
  });
});

describe('VocabularyService — vector payload resync on delete', () => {
  test('deleteTag resyncs the affected bookmarks with the tag removed', async () => {
    const { db, service, vector } = makeService();
    const category = createCategory(db, { datasetId: db.datasetId, name: 'dev' });
    const tag = createTag(db, { datasetId: db.datasetId, name: 'rust' });
    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      categoryId: category.id,
    });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });
    vector.ids.push(bookmark.id);

    await service.deleteTag(tag.id);

    expect(vector.payloads.length).toBe(1);
    expect(vector.payloads[0]!.bookmarkId).toBe(bookmark.id);
    expect(vector.payloads[0]!.patch.tagIds).toEqual([]);
    expect(vector.payloads[0]!.patch.categoryId).toBe(category.id);
  });

  test('deleteCategory resyncs the affected bookmarks with a null category', async () => {
    const { db, service, vector } = makeService();
    const category = createCategory(db, { datasetId: db.datasetId, name: 'dev' });
    const bookmark = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      categoryId: category.id,
    });
    vector.ids.push(bookmark.id);

    await service.deleteCategory(category.id);

    expect(vector.payloads.length).toBe(1);
    expect(vector.payloads[0]!.bookmarkId).toBe(bookmark.id);
    expect(vector.payloads[0]!.patch.categoryId).toBeNull();
    expect(vector.payloads[0]!.patch.tagIds).toEqual([]);
  });

  test('deletes on an empty index stay no-ops', async () => {
    const { db, service, vector } = makeService();
    const tag = createTag(db, { datasetId: db.datasetId, name: 'rust' });

    await service.deleteTag(tag.id);

    expect(vector.payloads).toEqual([]);
  });
});

describe('VocabularyService.setTagStatus', () => {
  test('activating a tag fans out classify jobs for its category scope only', () => {
    const { db, service, jobs } = makeService();

    const category = createCategory(db, { datasetId: db.datasetId, name: 'dev' });
    const tag = createTag(db, {
      datasetId: db.datasetId,
      name: 'rust',
      categoryId: category.id,
    });
    setTagStatus(db, tag.id, 'deprecated');
    const inScopeA = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      categoryId: category.id,
    });
    const inScopeB = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/b',
      categoryId: category.id,
    });
    const outside = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/outside',
    });

    const updated = service.setTagStatus(tag.id, 'active');

    expect(updated.status).toBe('active');
    const classified = jobs.calls.filter((call) => call.type === 'classify').map((call) => call.id);
    expect(classified.toSorted()).toEqual([inScopeA.id, inScopeB.id].toSorted());
    expect(classified).not.toContain(outside.id);
  });

  test('re-activating an already active tag enqueues nothing', () => {
    const { db, service, jobs } = makeService();

    const category = createCategory(db, { datasetId: db.datasetId, name: 'dev' });
    const tag = createTag(db, {
      datasetId: db.datasetId,
      name: 'rust',
      categoryId: category.id,
    });
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      categoryId: category.id,
    });

    service.setTagStatus(tag.id, 'active');

    expect(jobs.calls).toEqual([]);
  });

  test('an unknown tag id is NotFoundError', () => {
    const { service } = makeService();

    expect(() => service.setTagStatus('11111111-1111-4111-8111-111111111111', 'active')).toThrow(
      NotFoundError,
    );
  });
});
