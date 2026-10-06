import { describe, expect, test } from 'bun:test';

import type { ExtractionResult } from '@al-yo-bo/ai';
import { listBookmarks } from '@al-yo-bo/db';

import { createImportService } from '../src/services/import.ts';
import { makeDb, recordingEvents, recordingJobs } from './support.ts';

const MARKDOWN = ['## Dev', '- https://example.com/a', '- https://example.com/b', ''].join('\n');

/** LLM extraction stub answering the v2 `ExtractionResult` shape. */
function llmExtract(result: Partial<ExtractionResult>): ExtractionResult {
  return {
    bookmarks: [],
    provider: 'openrouter',
    model: 'test-model',
    warnings: [],
    ...result,
  };
}

describe('ImportService', () => {
  test('preview parses without writing anything (no LLM client -> fallback)', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const events = recordingEvents();
    const service = createImportService({ db, jobs, extract: null, events });

    const preview = await service.preview(MARKDOWN);

    expect(preview.parsed).toBe(2);
    expect(preview.skipped).toBe(0);
    expect(preview.provider).toBe('fallback');
    expect(preview.bookmarks.map((bookmark) => bookmark.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    // Tree-native parse: the H2 is the level-1 category path.
    expect(preview.bookmarks[0]!.categoryPath).toEqual(['Dev']);
    expect(jobs.calls).toEqual([]);
  });

  test('preview routes through the LLM client when one is provided', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const events = recordingEvents();
    const service = createImportService({
      db,
      jobs,
      extract: {
        async extract() {
          return llmExtract({
            bookmarks: [
              {
                url: 'https://example.com/x',
                title: 'x',
                description: null,
                categoryPath: ['Dev', 'Web'],
                priority: null,
                tags: [],
              },
            ],
          });
        },
      },
      events,
    });

    const preview = await service.preview('arbitrary text the LLM ignores');

    expect(preview.provider).toBe('llm');
    expect(preview.bookmarks.map((bookmark) => bookmark.url)).toEqual(['https://example.com/x']);
    expect(jobs.calls).toEqual([]);
  });

  test('preview falls back when the LLM client throws', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const events = recordingEvents();
    const service = createImportService({
      db,
      jobs,
      extract: {
        async extract(): Promise<ExtractionResult> {
          throw new Error('rate limit');
        },
      },
      events,
    });

    const preview = await service.preview(MARKDOWN);

    expect(preview.provider).toBe('fallback');
    expect(preview.warnings).toContain(
      'LLM extraction failed; falling back to deterministic parser.',
    );
    expect(preview.bookmarks).toHaveLength(2);
  });

  test('commit auto-creates missing vocabulary and enqueues scrape + screenshot', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const events = recordingEvents();
    const service = createImportService({ db, jobs, extract: null, events });

    const { bookmarks } = await service.preview(MARKDOWN);
    const report = service.commit(bookmarks, { file: 'collection.md' });

    expect(report.bookmarks).toBe(2);
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

    // A commit touches all three domains at once (ARCHITECTURE §9).
    const topics = events.events.map((event) => event.topic).toSorted();
    expect(topics).toEqual(['bookmarks.changed', 'categories.changed', 'tags.changed']);
  });

  test('a re-commit merges by URL (no new bookmark ids)', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const events = recordingEvents();
    const service = createImportService({ db, jobs, extract: null, events });

    const { bookmarks } = await service.preview(MARKDOWN);
    service.commit(bookmarks);
    jobs.calls.length = 0;
    const firstIds = listBookmarks(db).items.map((bookmark) => bookmark.id);

    const second = service.commit(bookmarks);

    const secondIds = listBookmarks(db).items.map((bookmark) => bookmark.id);
    expect(secondIds.toSorted()).toEqual(firstIds.toSorted());
    expect(second.bookmarks).toBe(2);
    expect(second.updated).toBe(2);
    expect(jobs.calls).toEqual([]); // re-commit: no scrape re-enqueue
  });

  test('commit skips rows with invalid URLs and records them in the report', () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const events = recordingEvents();
    const service = createImportService({ db, jobs, extract: null, events });

    const report = service.commit([
      {
        url: 'ftp://example.com/file',
        title: 'bad',
        description: null,
        categoryPath: [],
        priority: null,
        tags: [],
      },
      {
        url: 'not a url',
        title: 'worse',
        description: null,
        categoryPath: [],
        priority: null,
        tags: [],
      },
      {
        url: 'https://example.com/ok',
        title: 'ok',
        description: null,
        categoryPath: [],
        priority: null,
        tags: [],
      },
    ]);

    expect(report.added).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.bookmarks).toBe(1);
    expect(report.warnings?.length).toBe(2);
    expect(report.warnings?.[0]).toContain('ftp://example.com/file');
    // Only the valid row is enriched.
    const scrapeCalls = jobs.calls.filter((call) => call.type === 'scrape');
    expect(scrapeCalls).toHaveLength(1);
  });

  test('frontmatter tags are attached with source=import and auto-created active', async () => {
    const db = makeDb();
    const jobs = recordingJobs();
    const events = recordingEvents();
    const service = createImportService({ db, jobs, extract: null, events });

    const source = [
      '---',
      'tags: [rust, web]',
      '---',
      '## Dev',
      '- https://example.com/a',
      '',
    ].join('\n');
    const { bookmarks } = await service.preview(source);
    const report = service.commit(bookmarks);

    // Both frontmatter tags resolve (auto-created active) and attach to the
    // one bookmark with source='import' (user/import rows win, ARCHITECTURE §7).
    expect(report.tagsAssigned).toBe(2);
    const bookmark = listBookmarks(db).items[0]!;
    expect(bookmark.tags.map((tag) => [tag.name, tag.source]).toSorted()).toEqual([
      ['rust', 'import'],
      ['web', 'import'],
    ]);
  });
});
