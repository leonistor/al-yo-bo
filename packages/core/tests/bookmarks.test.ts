import { describe, expect, test } from 'bun:test';

import {
  createBookmark,
  createCategory,
  getBookmarkById,
  updateBookmark,
} from '@al-yo-bo/db';

import { createBookmarkService } from '../src/services/bookmarks.ts';
import { NotFoundError, ValidationError } from '../src/errors.ts';
import { createVectorProvider } from '../src/vector/provider.ts';
import { StubVectorIndex, makeDb, recordingJobs } from './support.ts';

function makeService(vector = new StubVectorIndex()) {
  const db = makeDb();
  const jobs = recordingJobs();
  const service = createBookmarkService({ db, jobs, vector: createVectorProvider(vector, 'memory') });
  return { db, jobs, vector, service };
}

describe('BookmarkService — get/create', () => {
  test('reports a missing bookmark as NotFoundError', () => {
    const { service } = makeService();
    expect(() => service.get('11111111-1111-4111-8111-111111111111')).toThrow(NotFoundError);
  });

  test('rejects non-HTTP(S) URLs before touching the database', () => {
    const { service } = makeService();
    expect(() => service.create({ url: 'ftp://example.com/file' })).toThrow(ValidationError);
  });

  test('creates a bookmark and enqueues a scrape', () => {
    const { service, jobs } = makeService();
    const created = service.create({ url: 'https://example.com/page', title: 'Page' });
    expect(created.url).toBe('https://example.com/page');
    expect(jobs.calls).toEqual([{ id: created.id, type: 'scrape' }]);
  });
});

describe('BookmarkService.update — re-run triggers', () => {
  test('a URL change resets dead-link evidence and enqueues a scrape', async () => {
    const { service, db, jobs } = makeService();
    const { id } = createBookmark(db, { url: 'https://example.com/old', title: 'Old' });
    updateBookmark(db, id, { scrapeAttempts: 2, status: 'invalid' });

    await service.update(id, { url: 'https://example.com/new' });

    const after = getBookmarkById(db, id)!;
    expect(after.url).toBe('https://example.com/new');
    expect(after.scrapeAttempts).toBe(0);
    expect(after.status).toBe('active');
    expect(jobs.calls).toEqual([{ id, type: 'scrape' }]);
  });

  test('a title change enqueues an embed instead of a scrape', async () => {
    const { service, db, jobs } = makeService();
    const { id } = createBookmark(db, { url: 'https://example.com/a', title: 'Before' });

    await service.update(id, { title: 'After' });

    expect(getBookmarkById(db, id)!.title).toBe('After');
    expect(jobs.calls).toEqual([{ id, type: 'embed' }]);
  });

  test('a category move syncs the vector payload without re-enriching', async () => {
    const { service, db, jobs, vector } = makeService(new StubVectorIndex(['already-indexed']));
    const from = createCategory(db, { name: 'From' });
    const to = createCategory(db, { name: 'To' });
    const { id } = createBookmark(db, { url: 'https://example.com/x', categoryId: from.id });

    await service.update(id, { categoryId: to.id });

    expect(jobs.calls).toEqual([]);
    expect(vector.payloads.length).toBe(1);
    expect(vector.payloads[0]!.bookmarkId).toBe(id);
    expect(vector.payloads[0]!.patch.categoryId).toBe(to.id);
  });
});

describe('BookmarkService.delete', () => {
  test('removes the row and mirrors the deletion into a non-empty index', async () => {
    const { service, db, vector } = makeService(new StubVectorIndex(['x']));
    const { id } = createBookmark(db, { url: 'https://example.com/gone' });

    await service.delete(id);

    expect(getBookmarkById(db, id)).toBeNull();
    expect(vector.deletions).toEqual([id]);
  });
});
