import { describe, expect, test } from 'bun:test';

import { parseCollection } from '@al-yo-bo/importer';
import type { BookmarkTagView, ExportBookmarkRow } from '@al-yo-bo/shared';

import {
  EXPORT_CONTENT_TYPES,
  filenameFor,
  toCsv,
  toExportJson,
  toMarkdownCollection,
  toNetscapeHtml,
} from '../src/index.ts';

function tag(name: string): BookmarkTagView {
  return { tagId: `tag-${name}`, name, source: 'import', confidence: null };
}

function simplifyRow(
  entry: Pick<ExportBookmarkRow, 'url' | 'title' | 'description' | 'categoryName' | 'tags'>,
): {
  url: string;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
} {
  return {
    url: entry.url,
    title: entry.title,
    description: entry.description,
    category: entry.categoryName,
    tags: entry.tags.map((t) => t.name).toSorted(),
  };
}

function bookmark({ url, ...overrides }: Partial<ExportBookmarkRow> & { url: string }): ExportBookmarkRow {
  return {
    id: `id-${url}`,
    datasetId: 'dataset',
    url,
    title: null,
    description: null,
    content: null,
    metadata: null,
    categoryId: null,
    contentHash: null,
    scrapedAt: null,
    status: 'active',
    scrapeAttempts: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    tags: [],
    categoryName: null,
    sectionName: null,
    ...overrides,
  };
}

describe('toNetscapeHtml', () => {
  test('escapes text and attribute values', () => {
    const html = toNetscapeHtml([
      bookmark({
        url: 'https://example.com/?a=1&b=2',
        title: 'A & B <C>',
        description: 'D & "E" <F>',
      }),
    ]);
    expect(html).toContain('HREF="https://example.com/?a=1&amp;b=2"');
    // Quotes are only escaped inside attributes, not in element text.
    expect(html).toContain('>A &amp; B &lt;C&gt;</A>');
    expect(html).toContain('<DD>D &amp; "E" &lt;F&gt;');
  });

  test('writes Unix-second timestamps and clamps above 2^32', () => {
    const html = toNetscapeHtml([
      bookmark({ url: 'https://example.com/a', title: 'A', createdAt: 1_700_000_000_000 }),
    ]);
    expect(html).toContain('ADD_DATE="1700000000"');
    expect(html).toContain('LAST_MODIFIED="1700000000"');

    const clamped = toNetscapeHtml([
      bookmark({ url: 'https://example.com/b', title: 'B', createdAt: 5_000_000_000_000 }),
    ]);
    expect(clamped).toContain('ADD_DATE="4294967295"');
  });

  test('strips commas and line breaks from TAGS', () => {
    const html = toNetscapeHtml([
      bookmark({
        url: 'https://example.com/a',
        title: 'A',
        tags: [tag('a,b'), tag('c"d'), tag('e\nf'), tag('  ')],
      }),
    ]);
    expect(html).toContain('TAGS="ab,cd,ef"');
  });

  test('nests categories under sections and orders groups alphabetically', () => {
    const html = toNetscapeHtml([
      bookmark({
        url: 'https://example.com/2',
        title: 'two',
        sectionName: 'Zeta',
        categoryName: 'Home',
        createdAt: 1_700_000_200_000,
      }),
      bookmark({
        url: 'https://example.com/1',
        title: 'one',
        sectionName: 'Alpha',
        categoryName: 'Dev',
        createdAt: 1_700_000_100_000,
      }),
      bookmark({
        url: 'https://example.com/3',
        title: 'three',
        categoryName: 'Solo',
        createdAt: 1_700_000_300_000,
      }),
      bookmark({ url: 'https://example.com/4', title: 'four', createdAt: 1_700_000_400_000 }),
    ]);

    expect(html.indexOf('>Alpha</H3>')).toBeGreaterThan(-1);
    expect(html.indexOf('>Zeta</H3>')).toBeGreaterThan(html.indexOf('>Alpha</H3>'));
    // Category folder inside its section folder; folder date = newest inside it.
    expect(html).toContain('    <DT><H3 ADD_DATE="1700000100">Alpha</H3>');
    expect(html).toContain('        <DT><H3 ADD_DATE="1700000100">Dev</H3>');
    // Top-level category folder for a category with no section.
    expect(html).toContain('    <DT><H3 ADD_DATE="1700000300">Solo</H3>');
    // Null-category row sits directly in the top-level DL, after the folders.
    expect(html.indexOf('four')).toBeGreaterThan(html.indexOf('Solo'));
  });

  test('emits a valid skeleton for empty input', () => {
    const html = toNetscapeHtml([]);
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain(
      '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
    );
    expect(html).toContain('<TITLE>Bookmarks</TITLE>');
    expect(html).toContain('<DL><p>\n</DL><p>');
  });
});

describe('toCsv', () => {
  test('emits the exact header for empty input', () => {
    expect(toCsv([])).toBe('folder,url,title,note,tags,created\n');
  });

  test('quotes fields per RFC 4180 and strips commas from tag names', () => {
    const csv = toCsv([
      bookmark({
        url: 'https://example.com/a,b',
        title: 'line1\nline2',
        description: 'say "hi", ok',
        tags: [tag('x,y'), tag('z')],
        sectionName: 'Sec,tion',
        categoryName: 'Cat',
        createdAt: 1_700_000_000_000,
      }),
    ]);
    expect(csv.startsWith('folder,url,title,note,tags,created\n')).toBe(true);
    expect(csv).toContain('"Sec,tion/Cat"');
    expect(csv).toContain('"https://example.com/a,b"');
    expect(csv).toContain('"line1\nline2"');
    expect(csv).toContain('"say ""hi"", ok"');
    expect(csv).toContain('"xy,z"');
    expect(csv).toContain('2023-11-14T22:13:20.000Z');
  });

  test('renders every folder-path shape', () => {
    const csv = toCsv([
      bookmark({ url: 'u1', sectionName: 'S', categoryName: 'C' }),
      bookmark({ url: 'u2', categoryName: 'C' }),
      bookmark({ url: 'u3', sectionName: 'S' }),
      bookmark({ url: 'u4' }),
    ]);
    const lines = csv.split('\n');
    expect(lines[1]?.startsWith('S/C,u1,')).toBe(true);
    expect(lines[2]?.startsWith('C,u2,')).toBe(true);
    expect(lines[3]?.startsWith('S,u3,')).toBe(true);
    expect(lines[4]?.startsWith(',u4,')).toBe(true);
  });
});

describe('toExportJson', () => {
  test('emits the exact top-level shape and preserves rows as-is', () => {
    const rows = [
      bookmark({
        url: 'https://example.com/a',
        title: 'A',
        description: 'D',
        tags: [tag('t')],
        categoryName: 'C',
        sectionName: 'S',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_005_000,
      }),
    ];
    const meta = { filters: { status: 'active', dateFrom: 1 }, exportedAt: 1_800_000_000_000 };

    const json = toExportJson(rows, meta);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      'format',
      'version',
      'exportedAt',
      'filters',
      'bookmarks',
    ]);
    expect(parsed['format']).toBe('al-yo-bo/export');
    expect(parsed['version']).toBe(1);
    expect(parsed['exportedAt']).toBe(1_800_000_000_000);
    expect(parsed['filters']).toEqual({ status: 'active', dateFrom: 1 });
    // Rows keep their domain-native epoch-ms timestamps.
    expect(parsed['bookmarks']).toEqual(rows);
    expect(json).toContain('\n  "format"');
    expect(json).toContain('"createdAt": 1700000000000');
  });
});

describe('toMarkdownCollection', () => {
  test('round-trips url/title/description/category/tags through parseCollection', () => {
    const rows: ExportBookmarkRow[] = [
      bookmark({
        url: 'https://example.com/a',
        title: 'Alpha',
        description: 'Alpha',
        tags: [tag('alpha'), tag('beta')],
        categoryName: 'Dev',
        sectionName: 'Tech',
        createdAt: 1_700_000_100_000,
        metadata: { import: { file: 'x.md', category: 'Dev', priority: 2 } },
      }),
      // A title containing `]` and a URL with a balanced `(...)` pair: bare
      // bullet URLs (never markdown link syntax) survive URL_RE +
      // stripTrailingPunctuation, so both round-trip.
      bookmark({
        url: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        title: 'Foo]Bar',
        description: 'Foo]Bar',
        tags: [tag('alpha'), tag('beta')],
        categoryName: 'Dev',
        sectionName: 'Tech',
        createdAt: 1_700_000_200_000,
      }),
      bookmark({
        url: 'https://example.com/c',
        title: null,
        description: null,
        tags: [tag('alpha'), tag('beta')],
        categoryName: 'Essentials',
        sectionName: 'Tech',
        createdAt: 1_700_000_300_000,
      }),
      bookmark({
        url: 'https://example.com/d',
        title: 'Delta',
        description: 'Delta',
        tags: [tag('alpha'), tag('beta')],
        categoryName: null,
        sectionName: null,
        createdAt: 1_700_000_400_000,
      }),
    ];

    const markdown = toMarkdownCollection(rows);
    const parsed = parseCollection(markdown);
    expect(parsed.skipped).toBe(0);

    const actual = parsed.bookmarks
      .map((entry) => ({
        url: entry.url,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        tags: entry.tags.toSorted(),
      }))
      .toSorted((a, b) => a.url.localeCompare(b.url));
    const expected = rows.map(simplifyRow).toSorted((a, b) => a.url.localeCompare(b.url));

    expect(actual).toEqual(expected);
    // Priority stars round-trip via metadata.import.priority.
    expect(parsed.bookmarks.find((entry) => entry.url === 'https://example.com/a')?.priority).toBe(
      2,
    );
  });

  test('frontmatter unions per-row tags (the parser tag set is file-global)', () => {
    const markdown = toMarkdownCollection([
      bookmark({ url: 'https://example.com/a', title: 'A', tags: [tag('red')], categoryName: 'C' }),
      bookmark({ url: 'https://example.com/b', title: 'B', tags: [tag('blue')], categoryName: 'C' }),
    ]);
    expect(markdown).toContain('tags: [red, blue]');
    const parsed = parseCollection(markdown);
    // The parser only ever accumulates tags across the file, so differing
    // per-row tag sets cannot round-trip individually — they union.
    expect(parsed.bookmarks.every((entry) => entry.tags.join(',') === 'red,blue')).toBe(true);
  });

  test('emits a minimal document for empty input', () => {
    expect(toMarkdownCollection([])).toBe('');
    expect(parseCollection('').bookmarks).toEqual([]);
  });
});

describe('format metadata', () => {
  test('filenameFor and EXPORT_CONTENT_TYPES cover every format', () => {
    expect(filenameFor('html')).toBe('alyobo-bookmarks.html');
    expect(filenameFor('json')).toBe('alyobo-bookmarks.json');
    expect(filenameFor('csv')).toBe('alyobo-bookmarks.csv');
    expect(filenameFor('markdown')).toBe('alyobo-bookmarks.md');

    expect(EXPORT_CONTENT_TYPES.html).toBe('text/html; charset=utf-8');
    expect(EXPORT_CONTENT_TYPES.json).toBe('application/json; charset=utf-8');
    expect(EXPORT_CONTENT_TYPES.csv).toBe('text/csv; charset=utf-8');
    expect(EXPORT_CONTENT_TYPES.markdown).toBe('text/markdown; charset=utf-8');
  });
});
