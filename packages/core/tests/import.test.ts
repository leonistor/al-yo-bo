import { describe, expect, test } from 'bun:test';

import { createImportService } from '../src/services/import.ts';
import { makeDb, recordingJobs } from './support.ts';

const MARKDOWN = ['## Dev', '- https://example.com/a', '- https://example.com/b', ''].join('\n');

describe('ImportService', () => {
  test('preview parses without writing anything', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs });

    const preview = service.preview(MARKDOWN);

    expect(preview.parsed).toBe(2);
    expect(preview.skipped).toBe(0);
    expect(preview.bookmarks.map((bookmark) => bookmark.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(jobs.calls).toEqual([]);
  });

  test('an import with new vocabulary is staged, not committed', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs });

    const report = service.import(MARKDOWN, db.datasetId, { file: 'collection.md' });

    expect(report.staged).toBe(true);
    expect(report.batchId).toBeDefined();
    expect(report.added).toBe(0);
    expect(report.proposals?.map((p) => `${p.kind}:${p.name}`)).toEqual(['section:Dev']);
    expect(jobs.calls).toEqual([]); // nothing committed, nothing enqueued
  });

  test('committing a staged batch after accepting its proposal imports and enqueues scrapes', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs });

    const staged = service.import(MARKDOWN, db.datasetId, { file: 'collection.md' });
    const section = db
      .query<{ id: Uint8Array }, [string]>('SELECT id FROM sections WHERE name = ?')
      .get('Dev');
    expect(section).not.toBeNull();

    // Accept the proposed section, then commit.
    db.query('UPDATE sections SET status = ? WHERE id = ?').run('active', section!.id);
    const report = service.commit(staged.batchId!);

    expect(report.added).toBe(2);
    expect(report.addedIds.length).toBe(2);
    const scrapes = jobs.calls.filter((call) => call.type === 'scrape').map((call) => call.id);
    expect(scrapes.toSorted()).toEqual([...report.addedIds].toSorted());
  });

  test('a re-import with resolved vocabulary commits directly and updates', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs });

    // First import stages; accept the section; commit.
    const staged = service.import(MARKDOWN, db.datasetId, { file: 'collection.md' });
    db.query('UPDATE sections SET status = ? WHERE name = ?').run('active', 'Dev');
    service.commit(staged.batchId!);
    jobs.calls.length = 0;

    // Second import: the section now resolves, so it commits immediately.
    const second = service.import(MARKDOWN, db.datasetId, { file: 'collection.md' });

    expect(second.staged).toBeUndefined();
    expect(second.added).toBe(0);
    expect(second.updated).toBe(2);
    expect(jobs.calls.filter((call) => call.type === 'scrape')).toEqual([]);
  });

  test('discarding a staged batch removes its proposed vocabulary', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs });

    const staged = service.import(MARKDOWN, db.datasetId, { file: 'collection.md' });
    service.discard(staged.batchId!);

    const section = db
      .query<{ id: Uint8Array }, [string]>('SELECT id FROM sections WHERE name = ?')
      .get('Dev');
    expect(section).toBeNull();
    expect(jobs.calls).toEqual([]);
  });
});
