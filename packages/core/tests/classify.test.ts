import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  assignTag,
  createBookmark,
  createCategory,
  createTag,
  getBookmarkTags,
  getBookmarksWithTagsByIds,
  listBelowThresholdCandidates,
  listUnknownClassificationLabels,
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

interface ResultRow {
  runId: string;
  tagName: string;
  selected: number;
  probability: number;
}

/** Immutable result rows for a bookmark, oldest run first. */
function readResults(db: Database, bookmarkId: string): ResultRow[] {
  return db
    .query<
      { run_id: Uint8Array; name: string; selected: number; probability: number },
      [Uint8Array]
    >(
      `SELECT cr.run_id AS run_id, t.name AS name, cr.selected AS selected,
              cr.probability AS probability
         FROM classification_results cr
         JOIN classification_runs r ON r.id = cr.run_id
         JOIN tags t ON t.id = cr.tag_id
        WHERE r.bookmark_id = ?
        ORDER BY r.created_at, r.rowid, t.name`,
    )
    .all(uuidToBytes(bookmarkId))
    .map((row) => ({
      runId: bytesToUuid(row.run_id),
      tagName: row.name,
      selected: row.selected,
      probability: row.probability,
    }));
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
    // The question was only asked for active candidates (the candidate set is
    // ALL active tags — the deprecated one is excluded).
    expect(Object.keys(calls[0]!.questions).toSorted()).toEqual(['rust', 'webdev']);
    expect(calls[0]!.state).toContain('Rust book');
  });

  test('below-threshold results stay evidence and surface in the review queue', async () => {
    await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.3, webdev: 0.1 })),
      fixture.bookmarkId,
    );

    expect(getBookmarkTags(db, fixture.bookmarkId)).toEqual([]);
    const candidates = listBelowThresholdCandidates(db, 0.5);
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

    // Durable evidence (MODEL.md): the unasked label is persisted in
    // unknown_classification_labels, linked to the run, with its probability.
    const runIds = db
      .query<{ id: Uint8Array }, [Uint8Array]>(
        'SELECT id FROM classification_runs WHERE bookmark_id = ?',
      )
      .all(uuidToBytes(fixture.bookmarkId))
      .map((row) => bytesToUuid(row.id));
    expect(runIds).toHaveLength(1);

    const labels = listUnknownClassificationLabels(db, runIds[0]!);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.rawLabel).toBe('mystery');
    expect(labels[0]!.probability).toBe(0.99);
    expect(labels[0]!.runId).toBe(runIds[0]!);
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

  // Candidate-set delta (the one behavioral change vs legacy): candidates are
  // ALL active tags, so the fixture's rust/webdev tags join the freshly created
  // ones in the same batches.
  test('batches candidate questions across multiple runs', async () => {
    const names = Array.from({ length: MAX_QUESTIONS_PER_CALL + 5 }, (_, index) => `tag-${index}`);
    for (const name of names) {
      createTag(db, { name });
    }
    const { id } = createBookmark(db, {
      url: 'https://example.com/big',
    });

    // One unasked label per response: each run persists its own evidence row.
    // The probabilities cover every candidate (rust/webdev included — they are
    // active tags in this db, part of the all-active-tags candidate set).
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
    for (const runId of runIds) {
      expect(listUnknownClassificationLabels(db, runId)).toHaveLength(1);
    }
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

  test('selected flags are reconciled to the latest run', async () => {
    await classifyBookmark(makeDeps(db, stubClassifier({ rust: 0.9 })), fixture.bookmarkId);
    await classifyBookmark(makeDeps(db, stubClassifier({ rust: 0.7 })), fixture.bookmarkId);

    const rustResults = readResults(db, fixture.bookmarkId).filter((row) => row.tagName === 'rust');
    expect(rustResults).toHaveLength(2); // one per run — evidence is never rewritten
    const selected = rustResults.filter((row) => row.selected === 1);
    expect(selected).toHaveLength(1);

    const latestRun = db
      .query<{ id: Uint8Array }, [Uint8Array]>(
        'SELECT id FROM classification_runs WHERE bookmark_id = ? ORDER BY rowid DESC LIMIT 1',
      )
      .get(uuidToBytes(fixture.bookmarkId))!;
    expect(selected[0]!.runId).toBe(bytesToUuid(latestRun.id));
  });

  test('retraction leaves prior results as immutable evidence', async () => {
    await classifyBookmark(makeDeps(db, stubClassifier({ rust: 0.9 })), fixture.bookmarkId);
    const outcome = await classifyBookmark(
      makeDeps(db, stubClassifier({ rust: 0.1 })),
      fixture.bookmarkId,
    );

    expect(outcome.retracted).toBe(1);
    expect(getBookmarkTags(db, fixture.bookmarkId)).toEqual([]);

    const rustResults = readResults(db, fixture.bookmarkId).filter((row) => row.tagName === 'rust');
    expect(rustResults).toHaveLength(2);
    expect(rustResults.map((row) => row.probability).toSorted()).toEqual([0.1, 0.9]);
    expect(readResults(db, fixture.bookmarkId).every((row) => row.selected === 0)).toBe(true);
  });
});
