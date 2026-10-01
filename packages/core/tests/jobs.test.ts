import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  createBookmark,
  createDataset,
  getBookmarkById,
  openDatabase,
  setupDatabase,
  updateBookmark,
} from '@al-yo-bo/db';
import { uuidToBytes } from '@al-yo-bo/shared';
import type { RankedCandidate, VectorFilter, VectorIndex, VectorUpsert } from '@al-yo-bo/shared';

import type { CoreConfig } from '../src/config.ts';
import {
  composeEmbedText,
  embedBookmark,
  reconcileEnrichment,
  scrapeAndStore,
  startJobQueue,
  type JobDeps,
  type JobQueue,
} from '../src/enrichment/jobs.ts';
import { makeScraper, ScrapeError, sha256Hex, type ScrapeFn } from '../src/scrape.ts';
import { testConfig } from './support.ts';

/** VectorIndex stub that records upserts and answers searches in insertion order. */
class RecordingVector implements VectorIndex {
  upserts: VectorUpsert[] = [];
  ids: string[] = [];

  get size(): number {
    return this.ids.length;
  }

  async upsert(point: VectorUpsert): Promise<void> {
    this.upserts.push(point);
    if (!this.ids.includes(point.bookmarkId)) {
      this.ids.push(point.bookmarkId);
    }
  }

  async updatePayload(): Promise<void> {}

  async delete(bookmarkId: string): Promise<void> {
    this.ids = this.ids.filter((id) => id !== bookmarkId);
  }

  async search(
    _query: Float32Array,
    topK: number,
    _filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    return this.ids.slice(0, Math.max(0, topK)).map((bookmarkId, index) => ({
      bookmarkId,
      rank: index + 1,
      score: 1,
    }));
  }
}

/** Queue stub that records enqueues without running them. */
function recordingQueue(): JobQueue & { calls: Array<{ id: string; type: string }> } {
  const calls: Array<{ id: string; type: string }> = [];
  return {
    calls,
    enqueue(id, type) {
      calls.push({ id, type });
    },
    pendingCount() {
      return 0;
    },
    async waitForIdle() {},
    stop() {},
  };
}

const stubEmbeddings = {
  async embed(texts: string[]) {
    return { vectors: texts.map(() => Float32Array.from([1, 2, 3])), dims: 3, model: 'stub-embed' };
  },
};

/** Config pinned to the production default embedding model, matching the old loader. */
function defaultConfig(): CoreConfig {
  return testConfig({ embeddings: { model: 'openai/text-embedding-3-small' } });
}

function makeDb(): Database & { datasetId: string } {
  const db = openDatabase(':memory:') as Database & { datasetId: string };
  setupDatabase(db);
  db.datasetId = createDataset(db, 'test').id;
  return db;
}

function makeDeps(
  db: Database,
  overrides: { scrape?: ScrapeFn; embeddings?: typeof stubEmbeddings; config?: CoreConfig } = {},
): JobDeps & { vector: RecordingVector; queue: ReturnType<typeof recordingQueue> } {
  const vector = new RecordingVector();
  const queue = recordingQueue();
  return {
    db,
    vector,
    queue,
    config: overrides.config ?? defaultConfig(),
    scrape:
      overrides.scrape ??
      (async () => {
        throw new ScrapeError('no scraper configured in this test');
      }),
    embeddings: overrides.embeddings ?? stubEmbeddings,
  };
}

describe('composeEmbedText', () => {
  test('joins title, description and content', () => {
    expect(composeEmbedText({ title: 'T', description: 'D', content: 'C' })).toBe('T\n\nD\n\nC');
  });

  test('truncates content to the remaining budget, keeping the head intact', () => {
    const text = composeEmbedText({ title: 'T', description: null, content: 'x'.repeat(200) }, 50);
    expect(text.startsWith('T\n\n')).toBe(true);
    expect(text.length).toBe(50);
  });

  test('truncates the head alone when there is no content budget', () => {
    const text = composeEmbedText({ title: 'T'.repeat(100), description: null, content: 'C' }, 20);
    expect(text.length).toBe(20);
    expect(text.includes('C')).toBe(false);
  });

  test('returns empty string when nothing is set', () => {
    expect(composeEmbedText({ title: null, description: null, content: null })).toBe('');
  });
});

describe('makeScraper', () => {
  const options = {
    timeoutMs: 1_000,
    maxContentChars: 200_000,
    binary: 'html-to-markdown',
    maxAttempts: 3,
  };

  test('converts fetched HTML and hashes the stored content', async () => {
    const scraper = makeScraper(options, {
      fetchPage: async () => ({ html: '<h1>Hi</h1>', contentType: 'text/html', finalUrl: null }),
      convert: async (html) => `# Hi (${html.length})`,
    });
    const result = await scraper('https://example.com');
    expect(result.content).toBe('# Hi (11)');
    expect(result.contentHash).toBe(sha256Hex(result.content));
    expect(result.metadata.scrape.truncated).toBe(false);
  });

  test('truncates content before hashing', async () => {
    const scraper = makeScraper(
      { ...options, maxContentChars: 10 },
      {
        fetchPage: async () => ({ html: 'x', contentType: 'text/html', finalUrl: null }),
        convert: async () => 'y'.repeat(100),
      },
    );
    const result = await scraper('https://example.com');
    expect(result.content.length).toBe(10);
    expect(result.metadata.scrape.truncated).toBe(true);
    expect(result.contentHash).toBe(sha256Hex(result.content));
  });

  test('reports fetch failures as ScrapeError', async () => {
    const scraper = makeScraper(options, {
      fetchPage: async () => {
        throw new ScrapeError('HTTP 404');
      },
      convert: async (html) => html,
    });
    expect(scraper('https://example.com')).rejects.toThrow(ScrapeError);
  });

  test('reports a missing binary as ScrapeError', () => {
    const scraper = makeScraper({ ...options, binary: 'definitely-not-a-real-binary' });
    expect(scraper('https://example.com')).rejects.toThrow(ScrapeError);
  });
});

describe('scrapeAndStore', () => {
  let db: Database & { datasetId: string };

  beforeEach(() => {
    db = makeDb();
  });

  test('persists scraped content and chains the embed job', async () => {
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/a',
      title: 'A',
    });
    const deps = makeDeps(db, {
      scrape: async () => ({
        content: '# Page',
        contentHash: sha256Hex('# Page'),
        metadata: {
          scrape: { at: 123, contentType: 'text/html', finalUrl: null, truncated: false },
        },
      }),
    });

    expect(await scrapeAndStore(deps, id)).toBe('scraped');
    const bookmark = getBookmarkById(db, id)!;
    expect(bookmark.content).toBe('# Page');
    expect(bookmark.contentHash).toBe(sha256Hex('# Page'));
    expect(bookmark.scrapedAt).not.toBeNull();
    expect(bookmark.metadata).toEqual({
      scrape: { at: 123, contentType: 'text/html', finalUrl: null, truncated: false },
    });
    expect(deps.queue.calls).toEqual([{ id, type: 'embed' }]);
  });

  test('an unchanged page skips downstream and refreshes scraped_at', async () => {
    const { id } = createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/b' });
    const hash = sha256Hex('# Same');
    const deps = makeDeps(db, {
      scrape: async () => ({
        content: '# Same',
        contentHash: hash,
        metadata: { scrape: { at: 1, contentType: null, finalUrl: null, truncated: false } },
      }),
    });

    await scrapeAndStore(deps, id);
    const scrapedAt = getBookmarkById(db, id)!.scrapedAt;
    expect(deps.queue.calls).toEqual([{ id, type: 'embed' }]);

    // Second run: same hash -> no re-embed.
    expect(await scrapeAndStore(deps, id)).toBe('unchanged');
    expect(deps.queue.calls.length).toBe(1);
    expect(getBookmarkById(db, id)!.scrapedAt).toBeGreaterThanOrEqual(scrapedAt!);
  });

  test('a scrape failure leaves the bookmark untouched and throws', async () => {
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/c',
      title: 'Keep',
    });
    const deps = makeDeps(db); // default scrape stub throws

    expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    const bookmark = getBookmarkById(db, id)!;
    expect(bookmark.title).toBe('Keep');
    expect(bookmark.content).toBeNull();
    expect(deps.queue.calls).toEqual([]);
  });

  test('marks a bookmark invalid after repeated dead-link failures', async () => {
    const { id } = createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/dead' });
    const deps = makeDeps(db, {
      scrape: async () => {
        throw new ScrapeError('Fetching dead failed: HTTP 404', 404);
      },
    });

    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    expect(getBookmarkById(db, id)!.scrapeAttempts).toBe(1);
    expect(getBookmarkById(db, id)!.status).toBe('active');

    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);

    const bookmark = getBookmarkById(db, id)!;
    expect(bookmark.status).toBe('invalid');
    expect(bookmark.scrapeAttempts).toBe(3);
    const scrapeMetadata = bookmark.metadata?.scrape as
      | { lastError?: { status: number | null; message: string } }
      | undefined;
    const lastError = scrapeMetadata?.lastError;
    expect(lastError?.status).toBe(404);
    expect(lastError?.message).toContain('HTTP 404');
  });

  test('honors the configured invalidation cap', async () => {
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/dead-cap',
    });
    const deps = makeDeps(db, {
      config: testConfig({ scrape: { ...testConfig().scrape, maxAttempts: 2 } }),
      scrape: async () => {
        throw new ScrapeError('HTTP 410', 410);
      },
    });

    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    expect(getBookmarkById(db, id)!.status).toBe('active');
    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    expect(getBookmarkById(db, id)!.status).toBe('invalid');
  });

  test('transient failures do not count toward invalidation', async () => {
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/flaky',
    });
    const deps = makeDeps(db, {
      scrape: async () => {
        throw new ScrapeError('socket timeout');
      },
    });

    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);

    const bookmark = getBookmarkById(db, id)!;
    expect(bookmark.status).toBe('active');
    expect(bookmark.scrapeAttempts).toBe(0);
    const scrapeMetadata = bookmark.metadata?.scrape as
      | { lastError?: { status: number | null } }
      | undefined;
    const lastError = scrapeMetadata?.lastError;
    expect(lastError?.status).toBeNull();
  });

  test('server errors are transient, not dead links', async () => {
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/error',
    });
    const deps = makeDeps(db, {
      scrape: async () => {
        throw new ScrapeError('HTTP 500', 500);
      },
    });

    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    expect(getBookmarkById(db, id)!.scrapeAttempts).toBe(0);
    expect(getBookmarkById(db, id)!.status).toBe('active');
  });

  test('a success after two dead links resets the counters and clears the error', async () => {
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/revive',
    });
    let dead = true;
    const deps = makeDeps(db, {
      scrape: async () => {
        if (dead) {
          throw new ScrapeError('HTTP 404', 404);
        }
        return {
          content: '# Back',
          contentHash: sha256Hex('# Back'),
          metadata: {
            scrape: { at: 9, contentType: 'text/html', finalUrl: null, truncated: false },
          },
        };
      },
    });

    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    await expect(scrapeAndStore(deps, id)).rejects.toThrow(ScrapeError);
    expect(getBookmarkById(db, id)!.scrapeAttempts).toBe(2);

    dead = false;
    expect(await scrapeAndStore(deps, id)).toBe('scraped');
    const bookmark = getBookmarkById(db, id)!;
    expect(bookmark.status).toBe('active');
    expect(bookmark.scrapeAttempts).toBe(0);
    const scrapeMetadata = bookmark.metadata?.scrape as { lastError?: unknown } | undefined;
    expect(scrapeMetadata?.lastError).toBeUndefined();
  });

  test('a success restores an invalid bookmark to active', async () => {
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/healed',
    });
    updateBookmark(db, id, { status: 'invalid', scrapeAttempts: 3 });
    const deps = makeDeps(db, {
      scrape: async () => ({
        content: '# Healed',
        contentHash: sha256Hex('# Healed'),
        metadata: { scrape: { at: 1, contentType: null, finalUrl: null, truncated: false } },
      }),
    });

    expect(await scrapeAndStore(deps, id)).toBe('scraped');
    const bookmark = getBookmarkById(db, id)!;
    expect(bookmark.status).toBe('active');
    expect(bookmark.scrapeAttempts).toBe(0);
  });
});

describe('embedBookmark', () => {
  test('stores the embedding and write-throughs the vector index', async () => {
    const db = makeDb();
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/d',
      title: 'D',
      content: 'Body',
    });
    const deps = makeDeps(db);

    expect(await embedBookmark(deps, id)).toBe('embedded');
    expect(deps.vector.ids).toEqual([id]);
    // The configured model is the stored identity, not the client's echo.
    expect(deps.vector.upserts[0]!.payload.model).toBe('openai/text-embedding-3-small');
    expect(deps.vector.upserts[0]!.vector).toEqual(Float32Array.from([1, 2, 3]));
  });

  test('is skipped without an embedding client or embeddable text', async () => {
    const db = makeDb();
    const { id } = createBookmark(db, { datasetId: db.datasetId, url: 'https://example.com/e' });

    const noClient = makeDeps(db, { embeddings: undefined });
    expect(await embedBookmark(noClient, id)).toBe('skipped');
    expect(noClient.vector.size).toBe(0);

    const noText = makeDeps(db);
    expect(await embedBookmark(noText, id)).toBe('skipped');
    expect(noText.vector.size).toBe(0);
  });
});

describe('job queue', () => {
  test('drains scrape+embed chains and reports idle', async () => {
    const db = makeDb();
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/f',
      title: 'F',
    });
    const vector = new RecordingVector();
    const queue = startJobQueue({
      db,
      vector,
      embeddings: stubEmbeddings,
      scrape: async () => ({
        content: '# F',
        contentHash: sha256Hex('# F'),
        metadata: { scrape: { at: 1, contentType: null, finalUrl: null, truncated: false } },
      }),
      config: testConfig(),
      baseDelayMs: 1,
    });

    queue.enqueue(id, 'scrape');
    await queue.waitForIdle();

    const bookmark = getBookmarkById(db, id)!;
    expect(bookmark.content).toBe('# F');
    expect(vector.ids).toEqual([id]); // embed chained from scrape
    expect(queue.pendingCount()).toBe(0);
    queue.stop();
  });

  test('drops failing jobs after the attempt cap and keeps the bookmark intact', async () => {
    const db = makeDb();
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/g',
      title: 'G',
    });
    let attempts = 0;
    const queue = startJobQueue({
      db,
      vector: new RecordingVector(),
      scrape: async () => {
        attempts += 1;
        throw new ScrapeError('boom');
      },
      maxAttempts: 3,
      config: testConfig(),
      baseDelayMs: 1,
    });

    queue.enqueue(id, 'scrape');
    await queue.waitForIdle();

    expect(attempts).toBe(3);
    expect(getBookmarkById(db, id)!.content).toBeNull();
    queue.stop();
  });

  test('deduplicates queued jobs per bookmark and type', async () => {
    const db = makeDb();
    const { id } = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/h',
      title: 'H',
    });
    let scrapes = 0;
    const queue = startJobQueue({
      db,
      vector: new RecordingVector(),
      scrape: async () => {
        scrapes += 1;
        return {
          content: '# H',
          contentHash: sha256Hex('# H'),
          metadata: { scrape: { at: 1, contentType: null, finalUrl: null, truncated: false } },
        };
      },
      config: testConfig(),
      baseDelayMs: 1,
    });

    queue.enqueue(id, 'scrape');
    queue.enqueue(id, 'scrape');
    await queue.waitForIdle();
    expect(scrapes).toBe(1);
    queue.stop();
  });
});

describe('reconcileEnrichment', () => {
  test('enqueues missing scrapes, missing embeddings and stale-model re-embeds', () => {
    const db = makeDb();
    const neverScraped = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/i',
    });
    const unembedded = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/j',
      content: 'scraped body',
      contentHash: 'h',
      scrapedAt: 1,
    });
    const staleModel = createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/k',
      content: 'body',
      contentHash: 'h',
      scrapedAt: 1,
    });
    // Embedded by an older model: must be re-embedded under the configured one.
    db.query(
      'INSERT INTO bookmark_embeddings (bookmark_id, model, dims, embedding) VALUES (?, ?, ?, ?)',
    ).run(uuidToBytes(staleModel.id), 'old-model', 2, new Uint8Array(8));

    const queue = recordingQueue();
    const report = reconcileEnrichment(queue, db, 'new-model');

    expect(report.scrape).toBe(1);
    expect(queue.calls.filter((call) => call.type === 'scrape').map((call) => call.id)).toEqual([
      neverScraped.id,
    ]);
    expect(report.embed).toBe(1);
    expect(report.reembed).toBe(1);
    expect(
      queue.calls
        .filter((call) => call.type === 'embed')
        .map((call) => call.id)
        .toSorted(),
    ).toEqual([unembedded.id, staleModel.id].toSorted());
  });

  test('skips embedding reconciliation when no model is configured', () => {
    const db = makeDb();
    createBookmark(db, {
      datasetId: db.datasetId,
      url: 'https://example.com/l',
      content: 'body',
      contentHash: 'h',
      scrapedAt: 1,
    });
    const queue = recordingQueue();

    const report = reconcileEnrichment(queue, db);

    expect(report).toEqual({ scrape: 0, embed: 0, reembed: 0 });
    expect(queue.calls).toEqual([]);
  });
});
