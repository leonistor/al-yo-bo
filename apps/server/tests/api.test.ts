import { beforeEach, describe, expect, test } from 'bun:test';

import { openDatabase, seedFromFile, setupDatabase } from '@al-yo-bo/db';

import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/env.ts';

function makeApp() {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  seedFromFile(db);
  return { db, app: createApp(db, loadConfig({})) };
}

function jsonRequest(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('bookmark API', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  test('lists the seeded library', async () => {
    const response = await app.request('/api/bookmarks');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(26);
    expect(body.items.length).toBe(20);
  });

  test('searches by keyword', async () => {
    const response = await app.request('/api/bookmarks?q=sqlite');
    const body = (await response.json()) as { total: number; mode: string };
    expect(body.total).toBeGreaterThan(0);
    expect(body.mode).toBe('keyword');
  });

  test('creates, updates and deletes a bookmark', async () => {
    const created = await app.request(
      '/api/bookmarks',
      jsonRequest({ url: 'https://example.com/new', title: 'New' }),
    );
    expect(created.status).toBe(201);
    const bookmark = (await created.json()) as { id: string; url: string; title: string };

    const patched = await app.request(
      `/api/bookmarks/${bookmark.id}`,
      jsonRequest({ title: 'Renamed' }, 'PATCH'),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { title: string }).title).toBe('Renamed');

    const removed = await app.request(`/api/bookmarks/${bookmark.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const missing = await app.request(`/api/bookmarks/${bookmark.id}`);
    expect(missing.status).toBe(404);
  });

  test('rejects invalid input with a problem+json error', async () => {
    const response = await app.request('/api/bookmarks', jsonRequest({}));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { title: string };
    expect(body.title).toContain('url');
  });

  test('assigns and removes a user tag', async () => {
    const bookmarks = (await (await app.request('/api/bookmarks?limit=1')).json()) as {
      items: { id: string }[];
    };
    const tags = (await (await app.request('/api/tags')).json()) as { id: string; name: string }[];
    const bookmarkId = bookmarks.items[0]!.id;
    const tagId = tags[0]!.id;

    const assigned = await app.request(`/api/bookmarks/${bookmarkId}/tags`, jsonRequest({ tagId }));
    expect(assigned.status).toBe(200);
    const withTags = (await assigned.json()) as { tags: { tagId: string; source: string }[] };
    expect(withTags.tags.some((tag) => tag.tagId === tagId && tag.source === 'user')).toBe(true);

    const removed = await app.request(`/api/bookmarks/${bookmarkId}/tags/${tagId}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
  });

  test('aggregates report the full library', async () => {
    const body = (await (await app.request('/api/aggregates')).json()) as {
      total: number;
      categories: unknown[];
      tags: unknown[];
    };
    expect(body.total).toBe(26);
    expect(body.categories.length).toBe(8);
    expect(body.tags.length).toBe(51);
  });
});

describe('import API', () => {
  test('previews and imports markdown', async () => {
    const { app } = makeApp();
    const markdown = '## dev\n\n- ** Tool: https://example.com/tool\n';

    const preview = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: markdown,
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { parsed: number }).parsed).toBe(1);

    const imported = await app.request('/api/import?file=test.md', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: markdown,
    });
    expect(imported.status).toBe(200);
    expect(((await imported.json()) as { added: number }).added).toBe(1);
  });
});

describe('review API', () => {
  test('returns empty queues when nothing was classified', async () => {
    const { app } = makeApp();
    const proposed = await app.request('/api/review/proposed-tags');
    const candidates = await app.request('/api/review/candidates');
    expect(((await proposed.json()) as unknown[]).length).toBe(0);
    expect(((await candidates.json()) as unknown[]).length).toBe(0);
  });
});
