import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  assignTag,
  createBookmark,
  createCategory,
  createDataset,
  createTag,
  getBookmarkTags,
  getBookmarksWithTagsByIds,
  openDatabase,
  setTagStatus,
  setupDatabase,
} from '@al-yo-bo/db';
import type { RankedCandidate, VectorFilter, VectorIndex } from '@al-yo-bo/shared';

import {
  buildQuestions,
  buildStateString,
  classifyBookmark,
  MAX_QUESTIONS_PER_CALL,
  type ClassifyDeps,
} from '../src/enrichment/classify.ts';
import { testConfig } from './support.ts';

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

function stubClassifier(probabilities: Record<string, number>, calls: DecideCall[] = []) {
  return {
    async decide(request: { state: string; questions: Record<string, unknown> }) {
      calls.push({ state: request.state, questions: request.questions });
      return { probabilities, model: 'laya:en' };
    },
  };
}

function makeDb(): Database & { datasetId: string } {
  const db = openDatabase(':memory:') as Database & { datasetId: string };
  setupDatabase(db);
  db.datasetId = createDataset(db, 'test').id;
  return db;
}

interface Fixture {
  db: Database;
  datasetId: string;
  bookmarkId: string;
  tagIds: { rust: string; webdev: string };
}

/** One category ("dev") with scoped active tags; bookmark in that category. */
function makeFixture(db: Database): Fixture {
  const datasetId = createDataset(db, 'test').id;
  const category = createCategory(db, { datasetId, name: 'dev' });
  const rust = createTag(db, { datasetId, name: 'rust', categoryId: category.id });
  const webdev = createTag(db, { datasetId, name: 'webdev', categoryId: category.id });
  const deprecated = createTag(db, { datasetId, name: 'inactive', categoryId: category.id });
  setTagStatus(db, deprecated.id, 'deprecated');
  const { id: bookmarkId } = createBookmark(db, {
    datasetId,
    url: 'https://example.com/rust',
    title: 'Rust book',
    description: 'Learn Rust',
    categoryId: category.id,
    content: 'Rust ownership and borrowing explained.',
  });
  return {
    db,
    datasetId,
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

  test('assigns tags at or above the threshold and records evidence', async () => {
    const calls: DecideCall[] = [];
    const outcome = await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.9, webdev: 0.5, inactive: 0.99 }, calls)),
      fixture.bookmarkId,
    );

    expect(outcome.status).toBe('classified');
    expect(outcome.runs).toBe(1);
    expect(outcome.assigned).toBe(2); // 0.9 and exactly-at-threshold 0.5

    const tags = getBookmarkTags(db, fixture.bookmarkId);
    const rust = tags.find((tag) => tag.name === 'rust')!;
    expect(rust.source).toBe('classifier');
    expect(rust.confidence).toBe(0.9);

    // Exactly-at-threshold qualifies (>=), the deprecated tag never does even at 0.99.
    expect(tags.some((tag) => tag.name === 'inactive')).toBe(false);
    // The question was only asked for active candidates.
    expect(Object.keys(calls[0]!.questions).toSorted()).toEqual(['rust', 'webdev']);
    expect(calls[0]!.state).toContain('Rust book');
  });

  test('below-threshold results stay evidence and surface in the review queue', async () => {
    await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.3, webdev: 0.1 })),
      fixture.bookmarkId,
    );

    expect(getBookmarkTags(db, fixture.bookmarkId)).toEqual([]);
    const candidates = await import('@al-yo-bo/db').then((m) =>
      m.listBelowThresholdCandidates(db, fixture.datasetId, 0.5),
    );
    expect(candidates.length).toBe(2);
    expect(candidates[0]!.tagName).toBe('rust'); // ranked by probability
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

  test('unknown labels are recorded as unknown, never auto-assigned, never propose a tag', async () => {
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
      unknown: 0,
    });

    const emptyDb = makeDb();
    const { id } = createBookmark(emptyDb, {
      datasetId: emptyDb.datasetId,
      url: 'https://example.com/none',
    });
    expect(await classifyBookmark(makeDeps(emptyDb, stubClassifier({ rust: 1 })), id)).toEqual({
      status: 'skipped',
      runs: 0,
      assigned: 0,
      unknown: 0,
    });
  });

  test('batches candidate questions across multiple runs', async () => {
    const category = createCategory(db, { datasetId: fixture.datasetId, name: 'big' });
    const names = Array.from({ length: MAX_QUESTIONS_PER_CALL + 5 }, (_, index) => `tag-${index}`);
    for (const name of names) {
      createTag(db, { datasetId: fixture.datasetId, name, categoryId: category.id });
    }
    const { id } = createBookmark(db, {
      datasetId: fixture.datasetId,
      url: 'https://example.com/big',
      categoryId: category.id,
    });

    const calls: DecideCall[] = [];
    const outcome = await classifyBookmark(
      makeDeps(db, stubClassifier(Object.fromEntries(names.map((name) => [name, 0.9])), calls)),
      id,
    );

    expect(outcome.runs).toBe(2);
    expect(outcome.assigned).toBe(names.length);
    expect(Object.keys(calls[0]!.questions).length).toBe(MAX_QUESTIONS_PER_CALL);
    expect(Object.keys(calls[1]!.questions).length).toBe(5);
  });
});
