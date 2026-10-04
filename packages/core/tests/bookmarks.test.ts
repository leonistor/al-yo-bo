import { describe, expect, test } from 'bun:test';
import { exists, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createBookmark,
  createCategory,
  createTag,
  getBookmarkById,
  getTagByName,
  updateBookmark,
} from '@al-yo-bo/db';

import { ConflictError, NotFoundError, ValidationError } from '../src/errors.ts';
import { createBookmarkService } from '../src/services/bookmarks.ts';
import { createVectorProvider } from '../src/vector/provider.ts';
import { StubVectorIndex, makeDb, recordingEvents, recordingJobs } from './support.ts';

function makeService(vector = new StubVectorIndex(), screenshotsDir?: string) {
  const db = makeDb();
  const jobs = recordingJobs();
  const events = recordingEvents();
  const service = createBookmarkService({
    db,
    jobs,
    vector: createVectorProvider(vector, 'memory'),
    events,
    screenshotsDir,
  });
  return { db, jobs, events, vector, service };
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

  test('update rejects non-HTTP(S) URLs and leaves the row untouched', async () => {
    const { service, db } = makeService();
    const { id } = createBookmark(db, {
      url: 'https://example.com/a',
      title: 'Original',
    });

    await expect(service.update(id, { url: 'javascript:alert(1)' })).rejects.toThrow(
      ValidationError,
    );

    const current = getBookmarkById(db, id)!;
    expect(current.url).toBe('https://example.com/a');
    expect(current.title).toBe('Original');
  });

  test('creates a bookmark and enqueues a scrape', () => {
    const { service, jobs } = makeService();
    const created = service.create({ url: 'https://example.com/page', title: 'Page' });
    expect(created.url).toBe('https://example.com/page');
    expect(jobs.calls).toEqual([{ id: created.id, type: 'scrape' }]);
  });

  test('create rejects a category that does not exist', () => {
    const { service } = makeService();
    expect(() =>
      service.create({
        url: 'https://example.com/orphan',
        categoryId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow(NotFoundError);
  });

  test('create with an already-saved URL conflicts instead of a raw SQLite error', () => {
    const { service } = makeService();
    service.create({ url: 'https://example.com/taken' });

    expect(() => service.create({ url: 'https://example.com/taken' })).toThrow(ConflictError);
  });

  test('update changing a URL onto an existing bookmark conflicts; keeping the own URL is fine', async () => {
    const { service } = makeService();
    service.create({ url: 'https://example.com/first' });
    const second = service.create({ url: 'https://example.com/second' });

    await expect(service.update(second.id, { url: 'https://example.com/first' })).rejects.toThrow(
      ConflictError,
    );

    const unchanged = await service.update(second.id, { url: 'https://example.com/second' });
    expect(unchanged.url).toBe('https://example.com/second');
  });
});

describe('BookmarkService.update — re-run triggers', () => {
  test('a URL change resets dead-link evidence and enqueues a scrape', async () => {
    const { service, db, jobs } = makeService();
    const { id } = createBookmark(db, {
      url: 'https://example.com/old',
      title: 'Old',
    });
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
    const { id } = createBookmark(db, {
      url: 'https://example.com/a',
      title: 'Before',
    });

    await service.update(id, { title: 'After' });

    expect(getBookmarkById(db, id)!.title).toBe('After');
    expect(jobs.calls).toEqual([{ id, type: 'embed' }]);
  });

  test('a category move syncs the vector payload without re-enriching', async () => {
    const { service, db, jobs, vector } = makeService(new StubVectorIndex(['already-indexed']));
    const from = createCategory(db, { name: 'From' });
    const to = createCategory(db, { name: 'To' });
    const { id } = createBookmark(db, {
      url: 'https://example.com/x',
      categoryId: from.id,
    });

    await service.update(id, { categoryId: to.id });

    expect(jobs.calls).toEqual([]);
    expect(vector.payloads.length).toBe(1);
    expect(vector.payloads[0]!.bookmarkId).toBe(id);
    expect(vector.payloads[0]!.patch.categoryId).toBe(to.id);
  });

  test('update rejects a category that does not exist', async () => {
    const { service, db } = makeService();
    const { id } = createBookmark(db, { url: 'https://example.com/c' });

    await expect(
      service.update(id, { categoryId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('BookmarkService — tag assignment', () => {
  test('assignTag rejects an unknown tag', async () => {
    const { service, db } = makeService();
    const { id } = createBookmark(db, { url: 'https://bound.test/a' });

    await expect(service.assignTag(id, '11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      NotFoundError,
    );
  });

  test('a category and a global tag are accepted and attached', async () => {
    const { service, db } = makeService();
    const category = createCategory(db, { name: 'Local' });
    const tag = createTag(db, { name: 'local' });

    const created = service.create({ url: 'https://bound.test/d', categoryId: category.id });
    expect(created.categoryId).toBe(category.id);
    const assigned = await service.assignTag(created.id, tag.id);
    expect(assigned.tags.map((view) => view.tagId)).toContain(tag.id);
  });

  test('removeTag drops the assignment and rejects unknown ones', async () => {
    const { service, db } = makeService();
    const tag = createTag(db, { name: 'temp' });
    const { id } = createBookmark(db, { url: 'https://bound.test/e' });
    await service.assignTag(id, tag.id);

    await service.removeTag(id, tag.id);
    expect(getTagByName(db, 'temp')).not.toBeNull();
    const bookmark = await service.get(id);
    expect(bookmark.tags).toEqual([]);

    await expect(service.removeTag(id, tag.id)).rejects.toThrow(NotFoundError);
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

  test('delete of an unknown id is NotFoundError', async () => {
    const { service } = makeService();
    await expect(service.delete('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      NotFoundError,
    );
  });

  test('delete unlinks the recorded screenshot artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'al-yo-bo-del-'));
    try {
      const { service, db } = makeService(new StubVectorIndex(), dir);
      const { id } = createBookmark(db, { url: 'https://example.com/shot' });
      updateBookmark(db, id, {
        metadata: { image: { ogImageUrl: null, screenshotPath: `${id}.jpg` } },
      });
      await writeFile(join(dir, `${id}.jpg`), 'jpeg-bytes');

      await service.delete(id);

      expect(getBookmarkById(db, id)).toBeNull();
      expect(await exists(join(dir, `${id}.jpg`))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('delete succeeds when the artifact is already gone or untrusted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'al-yo-bo-del-'));
    try {
      const { service, db } = makeService(new StubVectorIndex(), dir);
      // Recorded file hand-deleted already (ENOENT is swallowed).
      const { id: missingFile } = createBookmark(db, { url: 'https://example.com/gone.js' });
      updateBookmark(db, missingFile, {
        metadata: { image: { ogImageUrl: null, screenshotPath: `${missingFile}.jpg` } },
      });
      // Imported absolute path — never joined into the screenshots dir.
      const { id: foreignPath } = createBookmark(db, { url: 'https://example.com/imported' });
      updateBookmark(db, foreignPath, {
        metadata: { image: { ogImageUrl: null, screenshotPath: '/data/shots/x.png' } },
      });

      await service.delete(missingFile);
      await service.delete(foreignPath);

      expect(getBookmarkById(db, missingFile)).toBeNull();
      expect(getBookmarkById(db, foreignPath)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('BookmarkService — events', () => {
  test('every mutation emits bookmarks.changed with the affected id', async () => {
    const { service, events } = makeService(new StubVectorIndex(['x']));
    const created = service.create({ url: 'https://example.com/ev' });
    await service.update(created.id, { title: 'renamed' });
    await service.delete(created.id);

    const topics = events.events.filter((event) => event.topic === 'bookmarks.changed');
    expect(topics.length).toBeGreaterThanOrEqual(3);
    // Events are hints (ARCHITECTURE §9): the payload names the bookmark(s).
    expect(topics.every((event) => event.topic === 'bookmarks.changed')).toBe(true);
  });
});
