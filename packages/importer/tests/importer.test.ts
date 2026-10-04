import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import {
  createCategory,
  createTag,
  getBookmarkByUrl,
  getCategoryBySiblingName,
  getCategoryTree,
  getTagByName,
  openDatabase,
  setTagStatus,
  setupDatabase,
  updateBookmark,
} from '@al-yo-bo/db';

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

function freshDb(): Database {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  return db;
}

describe('parseCollection', () => {
  test('maps the heading tree into categoryPath chains', () => {
    const { bookmarks, skipped } = parseCollection(SAMPLE);
    expect(bookmarks.length).toBe(5);
    expect(skipped).toBe(1);

    const nviwatch = bookmarks[0];
    expect(nviwatch?.url).toBe('https://github.com/msminhas93/nviwatch');
    expect(nviwatch?.categoryPath).toEqual(['dev']);
    expect(nviwatch?.title).toBe('nviwatch (nviwatch --watch 3000 --cpu)');
    expect(nviwatch?.priority).toBeNull();

    const yaziAlt = bookmarks[2];
    expect(yaziAlt?.url).toBe('https://github.com/AnirudhG07/awesome-yazi');
    expect(yaziAlt?.categoryPath).toEqual(['dev']);

    const prioritized = bookmarks[3];
    expect(prioritized?.priority).toBe(3);
    // H3 is the child of the current H2 — the ancestor chain, not a flat name.
    expect(prioritized?.categoryPath).toEqual(['terminal trove', 'essentials']);
    expect(prioritized?.title).toBe('Yazi');
  });

  test('an H2 resets the path; bullets before any heading are uncategorized', () => {
    const { bookmarks } = parseCollection(`- loose: https://example.com/loose

## dev

- a: https://example.com/a

### sub

- b: https://example.com/b

## other

- c: https://example.com/c
`);
    expect(bookmarks[0]?.categoryPath).toEqual([]);
    expect(bookmarks[1]?.categoryPath).toEqual(['dev']);
    expect(bookmarks[2]?.categoryPath).toEqual(['dev', 'sub']);
    // The second H2 replaces the whole chain, not just the last segment.
    expect(bookmarks[3]?.categoryPath).toEqual(['other']);
  });

  test('a stray H3 with no preceding H2 promotes to level-1', () => {
    const { bookmarks } = parseCollection(`### orphan

- a: https://example.com/a
`);
    expect(bookmarks[0]?.categoryPath).toEqual(['orphan']);
  });

  test('strips trailing punctuation from URLs', () => {
    const { bookmarks } = parseCollection('- see (https://example.com/a).');
    expect(bookmarks[0]?.url).toBe('https://example.com/a');
  });

  test('keeps a URL whose trailing bracket closes an opener inside the URL', () => {
    const { bookmarks } = parseCollection('- wiki: (see https://en.wikipedia.org/wiki/Foo_(bar)).');
    expect(bookmarks[0]?.url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });

  test('strips an unmatched closing bracket as prose punctuation', () => {
    const { bookmarks } = parseCollection('- see https://example.com/a].');
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
    expect(bookmarks[0]?.categoryPath).toEqual(['dev']);
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
    expect(bookmarks[0]?.categoryPath).toEqual(['dev']);
    expect(bookmarks[1]?.categoryPath).toEqual(['later']);
    expect(bookmarks.every((bookmark) => bookmark.tags.length === 0)).toBe(true);
  });

  // Regression: a mid-file `---`-wrapped note (a paragraph plus bullets) used to
  // be consumed as frontmatter and vanish silently. It has no recognized key and
  // is not leading, so its lines must flow through as ordinary content.
  test('keeps a mid-file --- wrapped note with bullets as content', () => {
    const { bookmarks, warnings } = parseCollection(`## dev

- a: https://example.com/a

---

Note: a wrapped aside

- b: https://example.com/b

---
`);
    expect(bookmarks.map((bookmark) => bookmark.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(warnings).toBeUndefined();
  });

  test('still consumes a mid-file frontmatter block that carries tags', () => {
    const { bookmarks } = parseCollection(`## dev

- a: https://example.com/a

---
tags: [later]
---

- b: https://example.com/b
`);
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks[0]?.tags).toEqual([]);
    expect(bookmarks[1]?.tags).toEqual(['later']);
  });

  test('treats a leading --- block as frontmatter even without tags', () => {
    const { bookmarks, warnings } = parseCollection(`---
title: only
---

- a: https://example.com/a
`);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.tags).toEqual([]);
    expect(warnings).toEqual(['Unrecognized frontmatter key "title" was ignored.']);
  });

  test('warns about unrecognized keys in a consumed frontmatter block', () => {
    const { bookmarks, warnings } = parseCollection(`---
title: My collection
tags: [imported]
---

- a: https://example.com/a
`);
    expect(bookmarks[0]?.tags).toEqual(['imported']);
    expect(warnings).toEqual(['Unrecognized frontmatter key "title" was ignored.']);
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
  test('auto-creates the category chain for unmatched paths', () => {
    const db = freshDb();
    const { bookmarks } = parseCollection(SAMPLE);

    const resolution = resolveVocabulary(db, bookmarks);

    // Paths map to ids keyed by the ancestor chain; the tree gets the root and
    // the H3 child under it.
    const devId = resolution.categoryIds.get(JSON.stringify(['dev']));
    expect(devId).toBeDefined();
    expect(
      resolution.categoryIds.get(JSON.stringify(['terminal trove', 'essentials'])),
    ).toBeDefined();
    expect(resolution.tagIds.size).toBe(0);
    expect(resolution.categoriesCreated).toBe(3);
    expect(getCategoryBySiblingName(db, null, 'dev')).not.toBeNull();
    const troveId = getCategoryBySiblingName(db, null, 'terminal trove')?.id;
    expect(getCategoryBySiblingName(db, troveId ?? null, 'essentials')).not.toBeNull();
  });

  test('reuses existing vocabulary and creates only missing segments', () => {
    const db = freshDb();
    const { bookmarks } = parseCollection(SAMPLE);
    // Pre-create the root so resolveVocabulary must reuse it.
    const dev = createCategory(db, { name: 'dev' });

    const resolution = resolveVocabulary(db, bookmarks);

    expect(resolution.categoryIds.get(JSON.stringify(['dev']))).toBe(dev.id);
    // Still auto-creates the unmatched root + child (2 instead of 3).
    expect(resolution.categoriesCreated).toBe(2);
    expect(
      resolution.categoryIds.get(JSON.stringify(['terminal trove', 'essentials'])),
    ).toBeDefined();
  });

  test('sibling-unique names resolve independently per parent', () => {
    const db = freshDb();
    const bookmarks = [
      ...parseCollection('## web\n\n- a: https://example.com/a\n').bookmarks,
      ...parseCollection('## books\n\n### web\n\n- b: https://example.com/b\n').bookmarks,
    ];

    const resolution = resolveVocabulary(db, bookmarks);

    const webRoot = resolution.categoryIds.get(JSON.stringify(['web']));
    const webChild = resolution.categoryIds.get(JSON.stringify(['books', 'web']));
    expect(webRoot).toBeDefined();
    expect(webChild).toBeDefined();
    expect(webRoot).not.toBe(webChild);
  });

  test('frontmatter tags always resolve (auto-created if missing)', () => {
    const db = freshDb();
    const { bookmarks } = parseCollection(`---
tags: [imported, unknown]
---

- x: https://example.com/tag-test
`);
    const resolution = resolveVocabulary(db, bookmarks);

    expect(resolution.tagIds.get('imported')).toBeDefined();
    expect(resolution.tagIds.get('unknown')).toBeDefined();
    expect(getTagByName(db, 'imported')).not.toBeNull();
    expect(getTagByName(db, 'unknown')).not.toBeNull();
  });

  test('skips a previously deprecated tag instead of re-activating it', () => {
    const db = freshDb();
    const deprecated = createTag(db, { name: 'legacy' });
    setTagStatus(db, deprecated.id, 'deprecated');
    const { bookmarks } = parseCollection(`---
tags: [legacy]
---

- x: https://example.com/deprecated-tag
`);

    const resolution = resolveVocabulary(db, bookmarks);

    expect(resolution.tagIds.has('legacy')).toBe(false);
    expect(resolution.skippedTags).toEqual(['legacy']);
    // The existing row stays deprecated; no new duplicate tag is created.
    expect(getTagByName(db, 'legacy')?.status).toBe('deprecated');
  });
});

describe('ingest', () => {
  test('commits bookmarks with auto-created vocabulary and is idempotent', () => {
    const db = freshDb();
    const { bookmarks, skipped } = parseCollection(SAMPLE);

    const resolution = resolveVocabulary(db, bookmarks);
    const first = ingestBookmarks(db, bookmarks, resolution, {
      file: 'sample.md',
      skipped,
    });
    expect(first.added).toBe(5);
    expect(first.categoriesCreated).toBe(3);
    expect(first.skipped).toBe(1);

    const second = ingestBookmarks(db, bookmarks, resolution, {
      file: 'sample.md',
      skipped,
    });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(5);
  });

  test('shelves imported bookmarks at the leaf of their category path', () => {
    const db = freshDb();
    const { bookmarks } = parseCollection(
      '## dev\n\n### web\n\n- deep: https://example.com/deep\n',
    );

    const resolution = resolveVocabulary(db, bookmarks);
    const report = ingestBookmarks(db, bookmarks, resolution);

    expect(report.categoriesCreated).toBe(2);
    const stored = getBookmarkByUrl(db, 'https://example.com/deep');
    expect(stored).not.toBeNull();
    const tree = getCategoryTree(db);
    const dev = tree.find((node) => node.name === 'dev');
    const leaf = dev?.children.find((node) => node.name === 'web');
    expect(leaf?.id ?? null).toBe(stored?.categoryId ?? null);
  });

  // Regression: re-import used to replace `metadata` wholesale, wiping
  // `scrape` provenance and `image` refs and re-triggering screenshot/og
  // discovery on every import (ARCHITECTURE §7 merge-by-URL).
  test('re-import merges metadata instead of replacing it', () => {
    const db = freshDb();
    const { bookmarks } = parseCollection('## dev\n\n- x: https://example.com/merge-meta');
    const resolution = resolveVocabulary(db, bookmarks);
    ingestBookmarks(db, bookmarks, resolution, { file: 'one.md' });

    const existing = getBookmarkByUrl(db, 'https://example.com/merge-meta');
    if (!existing) {
      throw new Error('initial import did not create the bookmark');
    }
    updateBookmark(db, existing.id, {
      metadata: {
        ...existing.metadata,
        scrape: { finalUrl: 'https://example.com/final', truncated: false },
        image: { screenshotPath: '/data/shots/x.png' },
      },
    });

    ingestBookmarks(db, bookmarks, resolution, { file: 'two.md' });

    const after = getBookmarkByUrl(db, 'https://example.com/merge-meta');
    expect(after?.metadata?.scrape).toEqual({
      finalUrl: 'https://example.com/final',
      truncated: false,
    });
    expect(after?.metadata?.image).toEqual({ screenshotPath: '/data/shots/x.png' });
    // The importer's own block is refreshed to the latest file/path.
    expect(after?.metadata?.import).toEqual({
      file: 'two.md',
      categoryPath: ['dev'],
      priority: null,
    });
  });

  test('ingests an empty list without touching the database', () => {
    const db = freshDb();
    const report = ingestBookmarks(db, [], {
      categoryIds: new Map(),
      tagIds: new Map(),
      skippedTags: [],
      categoriesCreated: 0,
    });
    expect(report.added).toBe(0);
    expect(report.parsed).toBe(0);
  });

  test('assigns frontmatter tags after auto-creating them', () => {
    const db = freshDb();
    const { bookmarks } = parseCollection(`---
tags: [imported, unknown]
---

- x: https://example.com/tag-test
`);
    const resolution = resolveVocabulary(db, bookmarks);
    const report = ingestBookmarks(db, bookmarks, resolution);

    expect(report.tagsAssigned).toBe(2);
    expect(getTagByName(db, 'imported')).not.toBeNull();
    expect(getTagByName(db, 'unknown')).not.toBeNull();
  });

  test('does not assign a deprecated tag and surfaces a warning', () => {
    const db = freshDb();
    const deprecated = createTag(db, { name: 'legacy' });
    setTagStatus(db, deprecated.id, 'deprecated');
    const { bookmarks } = parseCollection(`---
tags: [legacy]
---

- x: https://example.com/deprecated-tag
`);
    const resolution = resolveVocabulary(db, bookmarks);
    const report = ingestBookmarks(db, bookmarks, resolution);

    expect(report.tagsAssigned).toBe(0);
    expect(report.warnings).toEqual([
      'Deprecated tag "legacy" was not assigned to imported bookmarks.',
    ]);
    const assignments = db
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM bookmark_tags')
      .get();
    expect(assignments?.count).toBe(0);
  });

  test('parses the canonical octocat fixture into the expected tree', async () => {
    const url = new URL('../../db/seeds/octocat.md', import.meta.url);
    const { bookmarks, skipped } = parseCollection(await Bun.file(url).text());

    expect(skipped).toBe(0);
    expect(bookmarks.length).toBe(25);

    const roots = new Set(bookmarks.map((bookmark) => bookmark.categoryPath[0]));
    expect([...roots].toSorted()).toEqual([
      'AI tools',
      'Design',
      'Dev tools',
      'GitHub',
      'Learning',
    ]);

    // H3 nesting lands as a two-segment chain.
    const bun = bookmarks.find((bookmark) => bookmark.url === 'https://bun.sh');
    expect(bun?.categoryPath).toEqual(['Dev tools', 'Runtimes & frameworks']);
    const mdn = bookmarks.find((bookmark) => bookmark.url === 'https://developer.mozilla.org');
    expect(mdn?.categoryPath).toEqual(['Learning', 'Reference']);
    // A bullet directly under an H2 (after an H3 block) keeps the last heading
    // context — the tree-native "last heading wins" rule.
    const chatgpt = bookmarks.find((bookmark) => bookmark.url === 'https://chatgpt.com');
    expect(chatgpt?.categoryPath).toEqual(['AI tools', 'Local & self-hosted']);

    // Every fixture bookmark carries the file-global frontmatter tag set.
    const allBookmarked = await Bun.file(url).text();
    const declared = /tags: \[(.*)\]/.exec(allBookmarked)?.[1] ?? '';
    const tagCount = declared.split(',').length;
    expect(bookmarks.every((bookmark) => bookmark.tags.length === tagCount)).toBe(true);
  });

  test('ingests the octocat fixture into the seeded tree shape', async () => {
    const url = new URL('../../db/seeds/octocat.md', import.meta.url);
    const { bookmarks } = parseCollection(await Bun.file(url).text());
    const db = freshDb();

    const resolution = resolveVocabulary(db, bookmarks);
    const report = ingestBookmarks(db, bookmarks, resolution, { file: 'octocat.md' });

    expect(report.added).toBe(25);
    // 5 roots (GitHub, AI tools, Dev tools, Learning, Design) + 9 children
    // (2 + 4 + 3) = 14 categories.
    expect(report.categoriesCreated).toBe(14);

    const tree = getCategoryTree(db);
    expect(tree.map((node) => node.name).toSorted()).toEqual([
      'AI tools',
      'Design',
      'Dev tools',
      'GitHub',
      'Learning',
    ]);
    const devTools = tree.find((node) => node.name === 'Dev tools');
    expect(devTools?.children.map((node) => node.name)).toEqual([
      'Runtimes & frameworks',
      'UI components',
      'Databases',
      'Editors',
    ]);
  });
});
