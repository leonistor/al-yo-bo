import { describe, expect, test } from 'bun:test';

import { openDatabase, setupDatabase } from '@al-yo-bo/db';

import { importMarkdown, ingestBookmarks, parseCollection } from '../src/index.ts';

const SAMPLE = `# stray title

## dev

- nviwatch (nviwatch --watch 3000 --cpu) https://github.com/msminhas93/nviwatch
- lf alt: https://yazi-rs.github.io/docs/installation, https://github.com/AnirudhG07/awesome-yazi
- a bullet with no link

## terminal trove

### essentials

- *** Yazi: https://yazi-rs.github.io/docs/quick-start
- ** Fresh editor: https://getfresh.dev/docs/getting-started/
`;

describe('parseCollection', () => {
  test('maps headings, notes, priorities and multiple URLs', () => {
    const { bookmarks, skipped } = parseCollection(SAMPLE);
    expect(bookmarks.length).toBe(5);
    expect(skipped).toBe(1);

    const nviwatch = bookmarks[0];
    expect(nviwatch?.url).toBe('https://github.com/msminhas93/nviwatch');
    expect(nviwatch?.category).toBe('dev');
    expect(nviwatch?.title).toBe('nviwatch (nviwatch --watch 3000 --cpu)');
    expect(nviwatch?.priority).toBeNull();

    const yaziAlt = bookmarks[2];
    expect(yaziAlt?.url).toBe('https://github.com/AnirudhG07/awesome-yazi');
    expect(yaziAlt?.category).toBe('dev');

    const prioritized = bookmarks[3];
    expect(prioritized?.priority).toBe(3);
    expect(prioritized?.subsection).toBe('essentials');
    expect(prioritized?.title).toBe('Yazi');
  });

  test('H3 context does not become a category', () => {
    const { bookmarks } = parseCollection(SAMPLE);
    expect(bookmarks.every((bookmark) => bookmark.category !== 'essentials')).toBe(true);
  });

  test('strips trailing punctuation from URLs', () => {
    const { bookmarks } = parseCollection('- see (https://example.com/a).');
    expect(bookmarks[0]?.url).toBe('https://example.com/a');
  });
});

describe('ingest', () => {
  test('imports into the database and is idempotent', () => {
    const db = openDatabase(':memory:');
    setupDatabase(db);

    const first = importMarkdown(db, SAMPLE, { file: 'sample.md' });
    expect(first.added).toBe(5);
    expect(first.categoriesCreated).toBe(2);
    expect(first.skipped).toBe(1);

    const second = importMarkdown(db, SAMPLE, { file: 'sample.md' });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(5);
    expect(second.categoriesCreated).toBe(0);
  });

  test('ingests an empty list without touching the database', () => {
    const db = openDatabase(':memory:');
    setupDatabase(db);
    const report = ingestBookmarks(db, []);
    expect(report.added).toBe(0);
    expect(report.parsed).toBe(0);
  });

  test('parses a real collection file from docs/examples-mds', async () => {
    const url = new URL('../../../docs/examples-mds/collect-Sep-20.md', import.meta.url);
    const { bookmarks } = parseCollection(await Bun.file(url).text());
    expect(bookmarks.length).toBeGreaterThan(10);
    expect(bookmarks.some((bookmark) => bookmark.url.includes('msminhas93/nviwatch'))).toBe(true);
    expect(bookmarks.some((bookmark) => bookmark.priority === 3)).toBe(true);
  });
});
