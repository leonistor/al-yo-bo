import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  assignTag,
  createBookmark,
  createCategory,
  createTag,
  getBookmarkTags,
  getBookmarksWithTagsByIds,
  openDatabase,
  setTagStatus,
  setupDatabase,
} from '@al-yo-bo/db';
import {
  bytesToUuid,
  uuidToBytes,
  type RankedCandidate,
  type VectorFilter,
  type VectorIndex,
} from '@al-yo-bo/shared';

import {
  buildQuestions,
  buildStateString,
  classifyBookmark,
  MAX_QUESTIONS_PER_CALL,
  type ClassifyDeps,
} from '../src/enrichment/classify.ts';
import { stubClassifier, testConfig } from './support.ts';

class NoVector implements VectorIndex {
  get size(): number {
    return 0;
  }
  async upsert(): Promise<void> {}
  async updatePayload(): Promise<void> {}
  async delete(): Promise<void> {}
  async search(
    _query: Float32Array,
    _topK: number,
    _filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    return [];
  }
}

interface DecideCall {
  state: string;
  questions: Record<string, unknown>;
}

function makeDb(): Database {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  return db;
}

interface Fixture {
  db: Database;
  bookmarkId: string;
  tagIds: { rust: string; webdev: string };
}

/**
 * One category ("dev") and a set of active + deprecated tags; the bookmark sits
 * in that category. Tags have no category anymore (MODEL.md principle 2), so
 * the candidate set for classification is ALL active tags.
 */
function makeFixture(db: Database): Fixture {
  const category = createCategory(db, { name: 'dev' });
  const rust = createTag(db, { name: 'rust' });
  const webdev = createTag(db, { name: 'webdev' });
  const deprecated = createTag(db, { name: 'inactive' });
  setTagStatus(db, deprecated.id, 'deprecated');
  const { id: bookmarkId } = createBookmark(db, {
    url: 'https://example.com/rust',
    title: 'Rust book',
    description: 'Learn Rust',
    categoryId: category.id,
    content: 'Rust ownership and borrowing explained.',
  });
  return {
    db,
    bookmarkId,
    tagIds: { rust: rust.id, webdev: webdev.id },
  };
}

function makeDeps(db: Database, classifier?: ClassifyDeps['classifier']): ClassifyDeps {
  return {
    db,
    vector: new NoVector(),
    classifier,
    config: testConfig({ autoAssignThreshold: 0.5 }),
  };
}

describe('buildStateString', () => {
  test('joins title, description, host and a truncated content excerpt', () => {
    const db = makeDb();
    const { bookmarkId } = makeFixture(db);
    const [bookmark] = getBookmarksWithTagsByIds(db, [bookmarkId]);
    const state = buildStateString(bookmark!);
    expect(state).toContain('Title: Rust book');
    expect(state).toContain('Description: Learn Rust');
    expect(state).toContain('Source: example.com');
    expect(state).toContain('Content: Rust ownership');
    expect(state.length).toBeLessThan(400);
  });
});

describe('buildQuestions', () => {
  test('one noul question per tag name', () => {
    const questions = buildQuestions(['rust', 'webdev']);
    expect(Object.keys(questions).toSorted()).toEqual(['rust', 'webdev']);
    expect(questions['rust']!.type).toBe('noul');
    expect(questions['rust']!.criteria?.true).toContain('rust');
  });
});

describe('classifyBookmark', () => {
  let db: Database;
  let fixture: Fixture;

  beforeEach(() => {
    db = makeDb();
    fixture = makeFixture(db);
  });

  test('assigns tags at or above the threshold and ignores deprecated tags', async () => {
    const calls: DecideCall[] = [];
    const outcome = await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.9, webdev: 0.5 }, calls)),
      fixture.bookmarkId,
    );

    expect(outcome.status).toBe('classified');
    expect(outcome.runs).toBe(1);
    expect(outcome.assigned).toBe(2); // 0.9 and exactly-at-threshold 0.5

    const tags = getBookmarkTags(db, fixture.bookmarkId);
    const rust = tags.find((tag) => tag.name === 'rust')!;
    expect(rust.source).toBe('classifier');
    expect(rust.confidence).toBe(0.9);

    // Exactly-at-threshold qualifies (>=).
    expect(tags.some((tag) => tag.name === 'webdev')).toBe(true);
    // The question was only asked for active candidates (the deprecated one is excluded).
    expect(Object.keys(calls[0]!.questions).toSorted()).toEqual(['rust', 'webdev']);
    expect(calls[0]!.state).toContain('Rust book');
  });

  test('below-threshold results are not assigned', async () => {
    await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.3, webdev: 0.1 })),
      fixture.bookmarkId,
    );

    expect(getBookmarkTags(db, fixture.bookmarkId)).toEqual([]);
  });

  test('user-sourced assignments are never overwritten', async () => {
    assignTag(db, {
      bookmarkId: fixture.bookmarkId,
      tagId: fixture.tagIds.rust,
      source: 'user',
    });

    await classifyBookmark(makeDeps(db, stubClassifier({ rust: 1.0 })), fixture.bookmarkId);

    const tags = getBookmarkTags(db, fixture.bookmarkId);
    expect(tags.length).toBe(1);
    expect(tags[0]!.source).toBe('user');
  });

  test('unknown labels are counted, never auto-assigned', async () => {
    const outcome = await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.9, mystery: 0.99 })),
      fixture.bookmarkId,
    );

    expect(outcome.unknown).toBe(1);
    expect(outcome.assigned).toBe(1);
    const tagNames = getBookmarkTags(db, fixture.bookmarkId).map((tag) => tag.name);
    expect(tagNames).toEqual(['rust']);
  });

  test('skips without a classifier or without candidates', async () => {
    expect(await classifyBookmark(makeDeps(db), fixture.bookmarkId)).toEqual({
      status: 'skipped',
      runs: 0,
      assigned: 0,
      retracted: 0,
      unknown: 0,
    });

    const emptyDb = makeDb();
    const { id } = createBookmark(emptyDb, {
      url: 'https://example.com/none',
    });
    expect(await classifyBookmark(makeDeps(emptyDb, stubClassifier({ rust: 1 })), id)).toEqual({
      status: 'skipped',
      runs: 0,
      assigned: 0,
      retracted: 0,
      unknown: 0,
    });
  });

  test('batches candidate questions across multiple runs', async () => {
    const names = Array.from({ length: MAX_QUESTIONS_PER_CALL + 5 }, (_, index) => `tag-${index}`);
    for (const name of names) {
      createTag(db, { name });
    }
    const { id } = createBookmark(db, {
      url: 'https://example.com/big',
    });

    const calls: DecideCall[] = [];
    const outcome = await classifyBookmark(
      makeDeps(
        db,
        stubClassifier(
          {
            ...Object.fromEntries(names.map((name) => [name, 0.9])),
            rust: 0.9,
            webdev: 0.9,
            mystery: 0.7,
          },
          calls,
        ),
      ),
      id,
    );

    // 25 fresh tags + rust + webdev = 27 active candidates → two runs (20 + 7).
    const candidateCount = names.length + 2;
    expect(outcome.runs).toBe(2);
    expect(outcome.assigned).toBe(candidateCount);
    expect(outcome.unknown).toBe(2);
    expect(Object.keys(calls[0]!.questions).length).toBe(MAX_QUESTIONS_PER_CALL);
    expect(Object.keys(calls[1]!.questions).length).toBe(candidateCount - MAX_QUESTIONS_PER_CALL);

    const runIds = db
      .query<{ id: Uint8Array }, [Uint8Array]>(
        'SELECT id FROM classification_runs WHERE bookmark_id = ?',
      )
      .all(uuidToBytes(id))
      .map((row) => bytesToUuid(row.id));
    expect(runIds).toHaveLength(2);
  });

  test('re-run retracts classifier assignments that no longer qualify', async () => {
    await classifyBookmark(makeDeps(db, stubClassifier({ rust: 0.9 })), fixture.bookmarkId);
    expect(getBookmarkTags(db, fixture.bookmarkId).map((tag) => tag.name)).toEqual(['rust']);

    const outcome = await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.3 })),
      fixture.bookmarkId,
    );

    expect(outcome.retracted).toBe(1);
    expect(getBookmarkTags(db, fixture.bookmarkId)).toEqual([]);
  });

  test('retraction never removes user- or import-sourced assignments', async () => {
    assignTag(db, { bookmarkId: fixture.bookmarkId, tagId: fixture.tagIds.rust, source: 'user' });
    assignTag(db, {
      bookmarkId: fixture.bookmarkId,
      tagId: fixture.tagIds.webdev,
      source: 'import',
    });

    const outcome = await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.1, webdev: 0.1 })),
      fixture.bookmarkId,
    );

    expect(outcome.retracted).toBe(0);
    expect(getBookmarkTags(db, fixture.bookmarkId).map((tag) => [tag.name, tag.source])).toEqual([
      ['rust', 'user'],
      ['webdev', 'import'],
    ]);
  });
});
