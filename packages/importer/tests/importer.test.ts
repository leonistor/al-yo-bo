import { describe, expect, test } from 'bun:test';

import {
  createDataset,
  getCategoryByName,
  getTagByName,
  openDatabase,
  setupDatabase,
} from '@al-yo-bo/db';
import { uuidToBytes } from '@al-yo-bo/shared';

import { ingestBookmarks, parseCollection, resolveVocabulary } from '../src/index.ts';

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

function freshDb() {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  const datasetId = createDataset(db, 'test').id;
  return { db, datasetId };
}

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
    expect(prioritized?.category).toBe('essentials');
    expect(prioritized?.title).toBe('Yazi');
  });

  test('H3 context is folded into the single category field', () => {
    const { bookmarks } = parseCollection(SAMPLE);
    // Bookmarks under the H3 heading pick up that name; the H2 name never appears
    // because the H3 wins while we are inside the H3 block.
    expect(bookmarks.some((bookmark) => bookmark.category === 'essentials')).toBe(true);
    expect(bookmarks.every((bookmark) => bookmark.category !== 'terminal trove')).toBe(true);
    // Bookmarks under the H2-only block carry the H2 name directly.
    expect(bookmarks.some((bookmark) => bookmark.category === 'dev')).toBe(true);
  });

  test('strips trailing punctuation from URLs', () => {
    const { bookmarks } = parseCollection('- see (https://example.com/a).');
    expect(bookmarks[0]?.url).toBe('https://example.com/a');
  });

  test('parses frontmatter tags and keeps frontmatter out of content', () => {
    const { bookmarks } = parseCollection(`---
tags: [imported, dev]
---

## dev

- link: https://example.com/one
`);
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0]?.tags).toEqual(['imported', 'dev']);
    expect(bookmarks[0]?.category).toBe('dev');
  });

  test('merges tags from concatenated frontmatter blocks positionally', () => {
    const { bookmarks } = parseCollection(`---
tags: [alpha]
---

## first

- a: https://example.com/a

---
tags: [beta]
---

## second

- b: https://example.com/b
`);
    expect(bookmarks[0]?.tags).toEqual(['alpha']);
    expect(bookmarks[1]?.tags).toEqual(['alpha', 'beta']);
  });

  test('does not treat a bare --- separator as frontmatter', () => {
    const { bookmarks } = parseCollection(`## dev

- x: https://example.com/x

---

## later

- y: https://example.com/y
`);
    expect(bookmarks[0]?.category).toBe('dev');
    expect(bookmarks[1]?.category).toBe('later');
    expect(bookmarks.every((bookmark) => bookmark.tags.length === 0)).toBe(true);
  });

  test('ignores URLs and bullets inside fenced code blocks', () => {
    const { bookmarks } = parseCollection(`## dev

\`\`\`bash
- leaked: https://example.com/leak
\`\`\`

- real: https://example.com/real
`);
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0]?.url).toBe('https://example.com/real');
  });
});

describe('resolveVocabulary', () => {
  test('auto-creates categories and tags for unmatched names', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks } = parseCollection(SAMPLE);

    const resolution = resolveVocabulary(db, datasetId, bookmarks);

    // Both unmatched names are resolved to ids (auto-create, no proposals).
    expect(resolution.categoryIds.has('dev')).toBe(true);
    expect(resolution.categoryIds.has('essentials')).toBe(true);
    expect(resolution.tagIds.size).toBe(0);
    // Active vocabulary rows exist for the previously-unmatched names.
    expect(getCategoryByName(db, datasetId, 'dev')).not.toBeNull();
    expect(getCategoryByName(db, datasetId, 'essentials')).not.toBeNull();
  });

  test('reuses existing active vocabulary and avoids duplicates', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks } = parseCollection(SAMPLE);
    // Pre-create the category so resolveVocabulary must reuse it.
    const devId = new Uint8Array(16).fill(1);
    db.query(
      'INSERT INTO categories (id, dataset_id, section_id, name, description) VALUES (?, ?, NULL, ?, NULL)',
    ).run(devId, uuidToBytes(datasetId), 'dev');

    const resolution = resolveVocabulary(db, datasetId, bookmarks);

    // The pre-existing 'dev' category id is reused.
    const devString = Array.from(devId, (b) => b.toString(16).padStart(2, '0')).join('');
    const expected = `${devString.slice(0, 8)}-${devString.slice(8, 12)}-${devString.slice(12, 16)}-${devString.slice(16, 20)}-${devString.slice(20)}`;
    expect(resolution.categoryIds.get('dev')).toBe(expected);
    // Still auto-creates the unmatched category.
    expect(resolution.categoryIds.has('essentials')).toBe(true);
  });

  test('frontmatter tags always resolve (auto-created if missing)', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks } = parseCollection(`---
tags: [imported, unknown]
---

- x: https://example.com/tag-test
`);
    const resolution = resolveVocabulary(db, datasetId, bookmarks);

    expect(resolution.tagIds.get('imported')).toBeDefined();
    expect(resolution.tagIds.get('unknown')).toBeDefined();
    expect(getTagByName(db, datasetId, 'imported', null)).not.toBeNull();
    expect(getTagByName(db, datasetId, 'unknown', null)).not.toBeNull();
  });
});

describe('ingest', () => {
  test('commits bookmarks with auto-created vocabulary and is idempotent', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks, skipped } = parseCollection(SAMPLE);

    const resolution = resolveVocabulary(db, datasetId, bookmarks);
    const first = ingestBookmarks(db, datasetId, bookmarks, resolution, {
      file: 'sample.md',
      skipped,
    });
    expect(first.added).toBe(5);
    expect(first.skipped).toBe(1);

    const second = ingestBookmarks(db, datasetId, bookmarks, resolution, {
      file: 'sample.md',
      skipped,
    });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(5);
  });

  test('ingests an empty list without touching the database', () => {
    const { db, datasetId } = freshDb();
    const report = ingestBookmarks(db, datasetId, [], {
      categoryIds: new Map(),
      tagIds: new Map(),
    });
    expect(report.added).toBe(0);
    expect(report.parsed).toBe(0);
  });

  test('assigns frontmatter tags after auto-creating them', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks } = parseCollection(`---
tags: [imported, unknown]
---

- x: https://example.com/tag-test
`);
    const resolution = resolveVocabulary(db, datasetId, bookmarks);
    const report = ingestBookmarks(db, datasetId, bookmarks, resolution);

    expect(report.tagsAssigned).toBe(2);
    expect(getTagByName(db, datasetId, 'imported', null)).not.toBeNull();
    expect(getTagByName(db, datasetId, 'unknown', null)).not.toBeNull();
  });

  test('parses a real collection file from docs/examples-mds', async () => {
    const url = new URL('../../../docs/examples-mds/collect-Sep-20.md', import.meta.url);
    const { bookmarks } = parseCollection(await Bun.file(url).text());
    expect(bookmarks.length).toBeGreaterThan(10);
    expect(bookmarks.some((bookmark) => bookmark.url.includes('msminhas93/nviwatch'))).toBe(true);
    expect(bookmarks.some((bookmark) => bookmark.priority === 3)).toBe(true);
  });
});
