import { describe, expect, test } from 'bun:test';

import { createBookmark, createCategory, createTag, setTagStatus } from '@al-yo-bo/db';

import { NotFoundError } from '../src/errors.ts';
import { createVocabularyService } from '../src/services/vocabulary.ts';
import { makeDb, recordingJobs } from './support.ts';

describe('VocabularyService.setTagStatus', () => {
  test('activating a tag fans out classify jobs for its category scope only', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createVocabularyService({ db, jobs, datasetId: db.datasetId });

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
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createVocabularyService({ db, jobs, datasetId: db.datasetId });

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
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createVocabularyService({ db, jobs, datasetId: db.datasetId });

    expect(() => service.setTagStatus('11111111-1111-4111-8111-111111111111', 'active')).toThrow(
      NotFoundError,
    );
  });
});
