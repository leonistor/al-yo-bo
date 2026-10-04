import { describe, expect, test } from 'bun:test';

import {
  listBookmarksForExport,
  listCategoryPath,
  openDatabase,
  setupDatabase,
} from '@al-yo-bo/db';
import { ingestBookmarks, parseCollection, resolveVocabulary } from '@al-yo-bo/importer';
import type { BookmarkTagView, CategoryNode, ExportBookmarkRow } from '@al-yo-bo/shared';

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

function simplifyRow(entry: ExportBookmarkRow): {
  url: string;
  title: string | null;
  description: string | null;
  categoryPath: string[];
  tags: string[];
} {
  return {
    url: entry.url,
    title: entry.title,
    description: entry.description,
    categoryPath: entry.categoryPath,
    tags: entry.tags.map((t) => t.name).toSorted(),
  };
}

function bookmark({
  url,
  ...overrides
}: Partial<ExportBookmarkRow> & { url: string }): ExportBookmarkRow {
  return {
    id: `id-${url}`,
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
    categoryPath: [],
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

  test('nests one folder level per categoryPath segment', () => {
    const html = toNetscapeHtml([
      bookmark({
        url: 'https://example.com/1',
        title: 'one',
        categoryPath: ['Alpha', 'Dev'],
        createdAt: 1_700_000_100_000,
      }),
      bookmark({
        url: 'https://example.com/2',
        title: 'two',
        categoryPath: ['Zeta', 'Home'],
        createdAt: 1_700_000_200_000,
      }),
      bookmark({
        url: 'https://example.com/3',
        title: 'three',
        categoryPath: ['Solo'],
        createdAt: 1_700_000_300_000,
      }),
      bookmark({ url: 'https://example.com/4', title: 'four', createdAt: 1_700_000_400_000 }),
    ]);

    expect(html.indexOf('>Alpha</H3>')).toBeGreaterThan(-1);
    expect(html.indexOf('>Zeta</H3>')).toBeGreaterThan(html.indexOf('>Alpha</H3>'));
    // One nested <DL> per path segment: Alpha (depth 1, 4 spaces) → Dev
    // (depth 2, 8 spaces) with the bookmark inside at 12 spaces.
    expect(html).toContain('    <DT><H3 ADD_DATE="1700000100">Alpha</H3>');
    expect(html).toContain('        <DT><H3 ADD_DATE="1700000100">Dev</H3>');
    expect(html).toContain('            <DT><A HREF="https://example.com/1"');
    // Top-level folder for a one-segment path; folder date = newest in subtree.
    expect(html).toContain('    <DT><H3 ADD_DATE="1700000300">Solo</H3>');
    // Empty-path rows sit directly in the top-level DL, after the folders.
    expect(html.indexOf('four')).toBeGreaterThan(html.indexOf('Solo'));
  });

  test('reuses one folder chain for sibling paths sharing a prefix', () => {
    const html = toNetscapeHtml([
      bookmark({ url: 'https://example.com/1', title: 'one', categoryPath: ['a', 'x'] }),
      bookmark({ url: 'https://example.com/2', title: 'two', categoryPath: ['a', 'y'] }),
      bookmark({ url: 'https://example.com/3', title: 'three', categoryPath: ['a'] }),
    ]);
    expect(html.match(/<DT><H3/g)?.length).toBe(3);
    expect(html.indexOf('>x</H3>')).toBeGreaterThan(-1);
    expect(html.indexOf('>y</H3>')).toBeGreaterThan(html.indexOf('>x</H3>'));
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
        categoryPath: ['Sec,tion', 'Cat'],
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

  test('joins the whole categoryPath with / and leaves uncategorized empty', () => {
    const csv = toCsv([
      bookmark({ url: 'u1', categoryPath: ['S', 'C', 'Sub'] }),
      bookmark({ url: 'u2', categoryPath: ['C'] }),
      bookmark({ url: 'u3', categoryPath: [] }),
    ]);
    const lines = csv.split('\n');
    expect(lines[1]?.startsWith('S/C/Sub,u1,')).toBe(true);
    expect(lines[2]?.startsWith('C,u2,')).toBe(true);
    expect(lines[3]?.startsWith(',u3,')).toBe(true);
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
        categoryPath: ['S', 'C'],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_005_000,
      }),
    ];
    const categories: CategoryNode[] = [
      {
        id: 'cat-s',
        parentId: null,
        sortOrder: 'a0',
        name: 'S',
        description: null,
        createdAt: 1,
        children: [
          {
            id: 'cat-c',
            parentId: 'cat-s',
            sortOrder: 'a0',
            name: 'C',
            description: null,
            createdAt: 2,
            children: [],
          },
        ],
      },
    ];
    const meta = {
      filters: { status: 'active', dateFrom: 1 },
      exportedAt: 1_800_000_000_000,
      categories,
    };

    const json = toExportJson(rows, meta);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      'format',
      'version',
      'exportedAt',
      'filters',
      'categories',
      'bookmarks',
    ]);
    expect(parsed['format']).toBe('al-yo-bo/export');
    expect(parsed['version']).toBe(2);
    expect(parsed['exportedAt']).toBe(1_800_000_000_000);
    expect(parsed['filters']).toEqual({ status: 'active', dateFrom: 1 });
    // The category tree passes through verbatim (roots then children, by
    // sortOrder — the caller's `getCategoryTree` contract).
    expect(parsed['categories']).toEqual(categories);
    // Rows keep their domain-native epoch-ms timestamps and categoryPath.
    expect(parsed['bookmarks']).toEqual(rows);
    expect(json).toContain('\n  "format"');
    expect(json).toContain('"createdAt": 1700000000000');
  });
});

describe('toMarkdownCollection', () => {
  test('round-trips url/title/description/categoryPath/tags through parseCollection', () => {
    const rows: ExportBookmarkRow[] = [
      bookmark({
        url: 'https://example.com/a',
        title: 'Alpha',
        description: 'Alpha',
        tags: [tag('alpha'), tag('beta')],
        categoryPath: ['Tech', 'Dev'],
        createdAt: 1_700_000_100_000,
        metadata: { import: { file: 'x.md', categoryPath: ['Tech', 'Dev'], priority: 2 } },
      }),
      // A title containing `]` and a URL with a balanced `(...)` pair: bare
      // bullet URLs (never markdown link syntax) survive URL_RE +
      // stripTrailingPunctuation, so both round-trip.
      bookmark({
        url: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        title: 'Foo]Bar',
        description: 'Foo]Bar',
        tags: [tag('alpha'), tag('beta')],
        categoryPath: ['Tech', 'Dev'],
        createdAt: 1_700_000_200_000,
      }),
      bookmark({
        url: 'https://example.com/c',
        title: null,
        description: null,
        tags: [tag('alpha'), tag('beta')],
        categoryPath: ['Tech', 'Essentials'],
        createdAt: 1_700_000_300_000,
      }),
      bookmark({
        url: 'https://example.com/d',
        title: 'Delta',
        description: 'Delta',
        tags: [tag('alpha'), tag('beta')],
        categoryPath: [],
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
        categoryPath: entry.categoryPath,
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

  test('emits an H2 per level-1 category and an H3 per child', () => {
    const markdown = toMarkdownCollection([
      bookmark({ url: 'https://example.com/root1', title: 'r1', categoryPath: ['Dev'] }),
      bookmark({ url: 'https://example.com/child', title: 'c', categoryPath: ['Dev', 'Web'] }),
      bookmark({ url: 'https://example.com/root2', title: 'r2', categoryPath: ['Books'] }),
    ]);
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith('## '))).toEqual(['## Books', '## Dev']);
    expect(lines.filter((line) => line.startsWith('### '))).toEqual(['### Web']);
    // Sibling roots sort alphabetically; each root's rows stay under it.
    expect(lines.indexOf('## Dev')).toBeGreaterThan(lines.indexOf('## Books'));
    expect(lines.indexOf('### Web')).toBeGreaterThan(lines.indexOf('## Dev'));
    const root1Line = lines.findIndex((line) => line.includes('https://example.com/root1'));
    expect(root1Line).toBeGreaterThan(lines.indexOf('## Dev'));
  });

  test('joins path segments beyond depth 2 into the H3 name (parser is depth-2)', () => {
    const markdown = toMarkdownCollection([
      bookmark({
        url: 'https://example.com/deep',
        title: 'deep',
        categoryPath: ['dev', 'web', '2024'],
      }),
    ]);
    expect(markdown).toContain('## dev');
    expect(markdown).toContain('### web/2024');
    const parsed = parseCollection(markdown);
    expect(parsed.bookmarks[0]?.categoryPath).toEqual(['dev', 'web/2024']);
  });

  test('emits uncategorized rows before any heading', () => {
    const markdown = toMarkdownCollection([
      bookmark({ url: 'https://example.com/loose', title: 'loose', categoryPath: [] }),
      bookmark({ url: 'https://example.com/kept', title: 'kept', categoryPath: ['Dev'] }),
    ]);
    const parsed = parseCollection(markdown);
    expect(parsed.bookmarks[0]?.categoryPath).toEqual([]);
    expect(parsed.bookmarks[1]?.categoryPath).toEqual(['Dev']);
  });

  test('frontmatter unions per-row tags (the parser tag set is file-global)', () => {
    const markdown = toMarkdownCollection([
      bookmark({
        url: 'https://example.com/a',
        title: 'A',
        tags: [tag('red')],
        categoryPath: ['C'],
      }),
      bookmark({
        url: 'https://example.com/b',
        title: 'B',
        tags: [tag('blue')],
        categoryPath: ['C'],
      }),
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

function byUrl(a: { url: string }, b: { url: string }): number {
  return a.url.localeCompare(b.url);
}

describe('db round-trip (octocat fixture)', () => {
  test('markdown → parse → ingest → export markdown → re-parse yields the same tree', async () => {
    const sourceUrl = new URL('../../db/seeds/octocat.md', import.meta.url);
    const source = await Bun.file(sourceUrl).text();

    const parsed = parseCollection(source);
    expect(parsed.skipped).toBe(0);

    const db = openDatabase(':memory:');
    setupDatabase(db);
    const resolution = resolveVocabulary(db, parsed.bookmarks);
    const report = ingestBookmarks(db, parsed.bookmarks, resolution, { file: 'octocat.md' });
    expect(report.added).toBe(25);

    // Hydrate export rows the way core will: resolved ancestor-chain paths.
    // Object.assign on freshly created hydration objects (the db returns new
    // objects per call) — matches the no-map-spread convention used in db.
    const rows = listBookmarksForExport(db).map((row) =>
      Object.assign(row, {
        categoryPath: row.categoryId
          ? listCategoryPath(db, row.categoryId).map((category) => category.name)
          : [],
      }),
    );
    expect(rows.length).toBe(25);

    const markdown = toMarkdownCollection(rows);
    const reparsed = parseCollection(markdown);
    expect(reparsed.skipped).toBe(0);

    // The comparison oracle is the ingested db state (not the raw first parse):
    // ingest normalizes URLs (e.g. bare hosts gain a trailing `/`), and the
    // round-trip must reproduce exactly what was committed.
    const original = rows
      .map((row) => ({
        url: row.url,
        title: row.title,
        description: row.description,
        categoryPath: row.categoryPath,
        priority: null as number | null,
        tags: row.tags.map((t) => t.name).toSorted(),
      }))
      .toSorted(byUrl);
    const roundTripped = reparsed.bookmarks
      .map((entry) => ({
        url: entry.url,
        title: entry.title,
        description: entry.description,
        categoryPath: entry.categoryPath,
        priority: entry.priority,
        tags: entry.tags.toSorted(),
      }))
      .toSorted(byUrl);

    expect(roundTripped).toEqual(original);

    // Re-ingesting the exported file merges by URL — nothing new, nothing lost.
    const secondResolution = resolveVocabulary(db, reparsed.bookmarks);
    const second = ingestBookmarks(db, reparsed.bookmarks, secondResolution, {
      file: 'octocat-roundtrip.md',
    });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(25);
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
