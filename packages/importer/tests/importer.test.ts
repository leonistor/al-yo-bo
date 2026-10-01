import { describe, expect, test } from 'bun:test';

import {
  createDataset,
  createTag,
  getCategoryByName,
  getSectionByName,
  getTagByName,
  openDatabase,
  setupDatabase,
} from '@al-yo-bo/db';
import { bytesToUuid, uuidToBytes } from '@al-yo-bo/shared';

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
    expect(prioritized?.subsection).toBe('essentials');
    expect(prioritized?.title).toBe('Yazi');
  });

  test('H3 context is a category candidate, not a section', () => {
    const { bookmarks } = parseCollection(SAMPLE);
    expect(bookmarks.every((bookmark) => bookmark.category !== 'essentials')).toBe(true);
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
  test('proposes sections, categories and tags for unmatched names', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks } = parseCollection(SAMPLE);

    const resolution = resolveVocabulary(db, datasetId, bookmarks);

    expect(resolution.sectionIds.has('dev')).toBe(false); // proposed, not resolved
    expect(resolution.proposals.map((p) => `${p.kind}:${p.name}`).toSorted()).toEqual([
      'category:essentials',
      'section:dev',
      'section:terminal trove',
    ]);
    // Proposed entries exist in the vocabulary tables.
    expect(getSectionByName(db, datasetId, 'dev')?.status).toBe('proposed');
    expect(getCategoryByName(db, datasetId, 'essentials')?.status).toBe('proposed');
  });

  test('reuses active vocabulary and follows rejected merges', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks } = parseCollection(SAMPLE);

    // Pre-create an active section "dev" and a rejected "terminal trove" merged
    // into a section "terminal".
    const devId = new Uint8Array(16).fill(1);
    db.query('INSERT INTO sections (id, dataset_id, name, status) VALUES (?, ?, ?, ?)').run(
      devId,
      uuidToBytes(datasetId),
      'dev',
      'active',
    );
    const terminalId = new Uint8Array(16).fill(2);
    const troveId = new Uint8Array(16).fill(3);
    db.query('INSERT INTO sections (id, dataset_id, name, status) VALUES (?, ?, ?, ?)').run(
      terminalId,
      uuidToBytes(datasetId),
      'terminal',
      'active',
    );
    db.query(
      'INSERT INTO sections (id, dataset_id, name, status, merged_into_id) VALUES (?, ?, ?, ?, ?)',
    ).run(troveId, uuidToBytes(datasetId), 'terminal trove', 'rejected', terminalId);

    const resolution = resolveVocabulary(db, datasetId, bookmarks);

    // "dev" resolves to the active section; "terminal trove" follows its merge.
    expect(resolution.sectionIds.get('dev')).toBe(bytesToUuid(devId));
    expect(resolution.sectionIds.get('terminal trove')).toBe(bytesToUuid(terminalId));
    // "essentials" is still a new category proposal.
    expect(resolution.proposals.map((p) => `${p.kind}:${p.name}`)).toEqual(['category:essentials']);
  });

  test('frontmatter tags propose only when no active tag matches', () => {
    const { db, datasetId } = freshDb();
    createTag(db, { datasetId, name: 'imported', status: 'active' });

    const { bookmarks } = parseCollection(`---
tags: [imported, unknown]
---

- x: https://example.com/tag-test
`);
    const resolution = resolveVocabulary(db, datasetId, bookmarks);

    expect(resolution.tagIds.get('imported')).toBeDefined();
    expect(resolution.tagIds.has('unknown')).toBe(false);
    expect(resolution.proposals.map((p) => `${p.kind}:${p.name}`)).toEqual(['tag:unknown']);
  });
});

describe('ingest', () => {
  test('commits bookmarks with a fully resolved vocabulary and is idempotent', () => {
    const { db, datasetId } = freshDb();
    const { bookmarks, skipped } = parseCollection(SAMPLE);

    // Propose, accept the proposals, then commit.
    resolveVocabulary(db, datasetId, bookmarks);
    db.query('UPDATE sections SET status = ? WHERE dataset_id = ?').run(
      'active',
      uuidToBytes(datasetId),
    );
    db.query('UPDATE categories SET status = ? WHERE dataset_id = ?').run(
      'active',
      uuidToBytes(datasetId),
    );
    const resolved = resolveVocabulary(db, datasetId, bookmarks);
    expect(resolved.proposals).toEqual([]);

    const first = ingestBookmarks(db, datasetId, bookmarks, resolved, {
      file: 'sample.md',
      skipped,
    });
    expect(first.added).toBe(5);
    expect(first.skipped).toBe(1);

    const second = ingestBookmarks(db, datasetId, bookmarks, resolved, {
      file: 'sample.md',
      skipped,
    });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(5);
  });

  test('ingests an empty list without touching the database', () => {
    const { db, datasetId } = freshDb();
    const report = ingestBookmarks(db, datasetId, [], {
      sectionIds: new Map(),
      categoryIds: new Map(),
      tagIds: new Map(),
      proposals: [],
    });
    expect(report.added).toBe(0);
    expect(report.parsed).toBe(0);
  });

  test('assigns only tags that already exist in the vocabulary', () => {
    const { db, datasetId } = freshDb();
    createTag(db, { datasetId, name: 'imported', status: 'active' });

    const { bookmarks } = parseCollection(`---
tags: [imported, unknown]
---

- x: https://example.com/tag-test
`);
    const resolution = resolveVocabulary(db, datasetId, bookmarks);
    // unknown is proposed; commit with the resolution as-is (it maps only imported).
    const report = ingestBookmarks(db, datasetId, bookmarks, resolution);

    expect(report.tagsAssigned).toBe(1);
    expect(getTagByName(db, datasetId, 'imported', null)).not.toBeNull();
    expect(getTagByName(db, datasetId, 'unknown', null)?.status).toBe('proposed');
  });

  test('parses a real collection file from docs/examples-mds', async () => {
    const url = new URL('../../../docs/examples-mds/collect-Sep-20.md', import.meta.url);
    const { bookmarks } = parseCollection(await Bun.file(url).text());
    expect(bookmarks.length).toBeGreaterThan(10);
    expect(bookmarks.some((bookmark) => bookmark.url.includes('msminhas93/nviwatch'))).toBe(true);
    expect(bookmarks.some((bookmark) => bookmark.priority === 3)).toBe(true);
  });
});
