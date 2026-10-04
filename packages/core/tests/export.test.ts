import { describe, expect, test } from 'bun:test';

import { createBookmark, createCategory, createTag, assignTag } from '@al-yo-bo/db';

import { ValidationError } from '../src/errors.ts';
import { createExportService } from '../src/services/export.ts';
import { makeDb } from './support.ts';

describe('ExportService', () => {
  test('rejects an empty formats list before touching the serializers', async () => {
    const db = makeDb();
    const service = createExportService({ db });

    await expect(service.run({}, [])).rejects.toBeInstanceOf(ValidationError);
  });

  test('rejects unknown formats at runtime', async () => {
    const db = makeDb();
    const service = createExportService({ db });

    await expect(service.run({}, ['json', 'docx' as 'json'])).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test('JSON export carries per-row category paths and the full category tree', async () => {
    const db = makeDb();
    const dev = createCategory(db, { name: 'Dev' });
    const web = createCategory(db, { name: 'Web', parentId: dev.id });
    const bookmark = createBookmark(db, {
      url: 'https://example.com/a',
      title: 'A',
      categoryId: web.id,
    });
    const tag = createTag(db, { name: 'rust' });
    assignTag(db, { bookmarkId: bookmark.id, tagId: tag.id, source: 'user' });

    const service = createExportService({ db });
    const [file] = await service.run({}, ['json']);

    expect(file!.filename).toBe('alyobo-bookmarks.json');
    const parsed = JSON.parse(file!.content) as {
      format: string;
      version: number;
      categories: Array<{ name: string; children: Array<{ name: string }> }>;
      bookmarks: Array<{ url: string; categoryPath: string[]; tags: Array<{ name: string }> }>;
    };
    expect(parsed.format).toBe('al-yo-bo/export');
    expect(parsed.version).toBe(2);
    // The path grammar is the ancestor chain (ARCHITECTURE §7).
    expect(parsed.bookmarks[0]!.categoryPath).toEqual(['Dev', 'Web']);
    expect(parsed.bookmarks[0]!.tags.map((tag_) => tag_.name)).toEqual(['rust']);
    // meta.categories is the nested tree from getCategoryTree.
    expect(parsed.categories).toHaveLength(1);
    expect(parsed.categories[0]!.name).toBe('Dev');
    expect(parsed.categories[0]!.children[0]!.name).toBe('Web');
  });

  test('respects the search-shaped filters', async () => {
    const db = makeDb();
    const dev = createCategory(db, { name: 'Dev' });
    createBookmark(db, { url: 'https://example.com/a', title: 'in dev', categoryId: dev.id });
    createBookmark(db, { url: 'https://example.com/b', title: 'loose' });

    const service = createExportService({ db });
    const [file] = await service.run({ categoryId: dev.id }, ['csv']);
    const rows = file!.content.trim().split('\n');

    expect(rows).toHaveLength(2); // header + one row
    expect(rows[1]).toContain('Dev');
  });
});
