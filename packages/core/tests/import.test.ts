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

  test('import enqueues a scrape for every newly added bookmark', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs });

    const report = service.import(MARKDOWN, { file: 'collection.md' });

    expect(report.added).toBe(2);
    expect(report.addedIds.length).toBe(2);
    const scrapes = jobs.calls.filter((call) => call.type === 'scrape').map((call) => call.id);
    expect(scrapes.toSorted()).toEqual([...report.addedIds].toSorted());
  });

  test('a re-import updates instead of enqueuing duplicates', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs });

    service.import(MARKDOWN, { file: 'collection.md' });
    jobs.calls.length = 0;

    const second = service.import(MARKDOWN, { file: 'collection.md' });

    expect(second.added).toBe(0);
    expect(second.updated).toBe(2);
    expect(jobs.calls.filter((call) => call.type === 'scrape')).toEqual([]);
  });
});
