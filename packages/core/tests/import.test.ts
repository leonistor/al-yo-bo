import { describe, expect, test } from 'bun:test';

import { listBookmarks } from '@al-yo-bo/db';

import { createImportService } from '../src/services/import.ts';
import { makeDb, recordingJobs } from './support.ts';

const MARKDOWN = ['## Dev', '- https://example.com/a', '- https://example.com/b', ''].join('\n');

describe('ImportService', () => {
  test('preview parses without writing anything (no LLM client -> fallback)', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs, extract: null });

    const preview = await service.preview(MARKDOWN);

    expect(preview.parsed).toBe(2);
    expect(preview.skipped).toBe(0);
    expect(preview.provider).toBe('fallback');
    expect(preview.bookmarks.map((bookmark) => bookmark.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(jobs.calls).toEqual([]);
  });

  test('preview routes through the LLM client when one is provided', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({
      db,
      jobs,
      extract: {
        async extract() {
          return [
            { url: 'https://example.com/x', title: 'x', description: null, category: null, priority: null, tags: [] },
          ];
        },
      },
    });

    const preview = await service.preview('arbitrary text the LLM ignores');

    expect(preview.provider).toBe('llm');
    expect(preview.bookmarks.map((bookmark) => bookmark.url)).toEqual(['https://example.com/x']);
    expect(jobs.calls).toEqual([]);
  });

  test('preview falls back when the LLM client throws', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({
      db,
      jobs,
      extract: {
        async extract() {
          throw new Error('rate limit');
        },
      },
    });

    const preview = await service.preview(MARKDOWN);

    expect(preview.provider).toBe('fallback');
    expect(preview.warnings).toContain('LLM extraction failed; falling back to deterministic parser.');
    expect(preview.bookmarks).toHaveLength(2);
  });

  test('commit auto-creates missing vocabulary and enqueues scrape + screenshot', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs, extract: null });

    const { bookmarks } = await service.preview(MARKDOWN);
    const report = service.commit(bookmarks, db.datasetId, { file: 'collection.md' });

    expect(report.bookmarks).toHaveLength(2);
    expect(report.parsed).toBe(2);
    expect(report.added).toBe(2);
    const category = db
      .query<{ id: Uint8Array }, [string]>('SELECT id FROM categories WHERE name = ?')
      .get('Dev');
    expect(category).not.toBeNull();

    const scrapeCalls = jobs.calls.filter((call) => call.type === 'scrape');
    const screenshotCalls = jobs.calls.filter((call) => call.type === 'screenshot');
    expect(scrapeCalls).toHaveLength(2);
    expect(screenshotCalls).toHaveLength(2);
  });

  test('a re-commit merges by URL (no new bookmark ids)', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs, extract: null });

    const { bookmarks } = await service.preview(MARKDOWN);
    service.commit(bookmarks, db.datasetId);
    jobs.calls.length = 0;
    const firstIds = listBookmarks(db, { datasetId: db.datasetId }).items.map(
      (bookmark) => bookmark.id,
    );

    const second = service.commit(bookmarks, db.datasetId);

    const secondIds = listBookmarks(db, { datasetId: db.datasetId }).items.map(
      (bookmark) => bookmark.id,
    );
    expect(secondIds.toSorted()).toEqual(firstIds.toSorted());
    expect(second.bookmarks).toHaveLength(2);
    expect(second.updated).toBe(2);
    expect(jobs.calls).toEqual([]); // re-commit: no scrape re-enqueue
  });

  test('commit skips rows with invalid URLs and records them in the report', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const service = createImportService({ db, jobs, extract: null });

    const report = service.commit(
      [
        { url: 'ftp://example.com/file', title: 'bad', description: null, category: null, priority: null, tags: [] },
        { url: 'not a url', title: 'worse', description: null, category: null, priority: null, tags: [] },
        { url: 'https://example.com/ok', title: 'ok', description: null, category: null, priority: null, tags: [] },
      ],
      db.datasetId,
    );

    expect(report.added).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.bookmarks.map((bookmark) => bookmark.url)).toEqual(['https://example.com/ok']);
    expect(report.warnings?.length).toBe(2);
    expect(report.warnings?.[0]).toContain('ftp://example.com/file');
    // Only the valid row is enriched.
    const scrapeCalls = jobs.calls.filter((call) => call.type === 'scrape');
    expect(scrapeCalls).toHaveLength(1);
  });
});
