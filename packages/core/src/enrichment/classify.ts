/**
 * Classification workflow (ARCHITECTURE §7): build a state string from the
 * bookmark, ask one batched `noul` question per candidate tag, persist immutable
 * runs/results, then apply the deterministic assignment policy
 * (probability ≥ threshold AND tag active AND not user-assigned).
 *
 * Ollaya is optional (§1.5): without a classifier client this degrades to a
 * no-op — bookmarks stay browsable, searchable and manually taggable.
 *
 * Candidate set (decided, §7 stage 0): ALL `active` tags — tags have no
 * category and there is no scoping axis left (MODEL.md principles 1-2). The
 * per-call cap below keeps run size bounded; candidate-set precision as the
 * vocabulary grows is a §13 revisit trigger.
 *
 * The classifier never creates vocabulary (MODEL.md principle 5): unknown
 * labels are persisted as `unknown_classification_labels` evidence rows and
 * never become assignments.
 */

import type { Database } from 'bun:sqlite';

import type { ClassifierClient, NoulQuestion } from '@al-yo-bo/ai';
import {
  assignTag,
  candidatesForBookmark,
  createClassificationResult,
  createClassificationRun,
  createUnknownClassificationLabel,
  getBookmarksWithTagsByIds,
  listUserTagIds,
  reconcileClassifierAssignments,
} from '@al-yo-bo/db';
import { hostFromUrl, type BookmarkWithTags, type Tag, type VectorIndex } from '@al-yo-bo/shared';

import type { CoreConfig } from '../config.ts';
import { syncVectorPayload } from '../vector/sync.ts';

/** One `noul` question per candidate tag, capped per decide call. */
export const MAX_QUESTIONS_PER_CALL = 20;

/** Lead-excerpt budget for the state string (~350 tokens, §7 context limit). */
export const STATE_EXCERPT_CHARS = 1_400;

export interface ClassifyDeps {
  db: Database;
  vector: VectorIndex;
  classifier?: ClassifierClient;
  config: CoreConfig;
}

export interface ClassifyOutcome {
  status: 'classified' | 'skipped' | 'missing';
  /** Number of decide calls persisted (a bookmark may produce several). */
  runs: number;
  /** Assignments written with source='classifier'. */
  assigned: number;
  /** Stale classifier assignments removed because this run no longer qualified them. */
  retracted: number;
  /** Unknown labels the daemon returned (recorded as evidence, never auto-assigned). */
  unknown: number;
}

/** Builds the state string: title, description, URL host, lead content excerpt. */
export function buildStateString(
  bookmark: BookmarkWithTags,
  excerptChars = STATE_EXCERPT_CHARS,
): string {
  const lines: string[] = [];
  if (bookmark.title?.trim()) {
    lines.push(`Title: ${bookmark.title.trim()}`);
  }
  if (bookmark.description?.trim()) {
    lines.push(`Description: ${bookmark.description.trim()}`);
  }
  const host = hostFromUrl(bookmark.url);
  if (host) {
    lines.push(`Source: ${host}`);
  }
  const excerpt = bookmark.content?.trim().slice(0, excerptChars);
  if (excerpt) {
    lines.push(`Content: ${excerpt}`);
  }
  return lines.join('\n');
}

/** One yes/no question per candidate tag; labels are the tag names. */
export function buildQuestions(tagNames: string[]): Record<string, NoulQuestion> {
  return Object.fromEntries(
    tagNames.map((name) => [
      name,
      {
        type: 'noul' as const,
        instructions: `Decide whether the bookmark described in the state fits the tag "${name}".`,
        criteria: {
          true: `The bookmark clearly matches the "${name}" tag.`,
          false: `The bookmark does not clearly match the "${name}" tag.`,
        },
      },
    ]),
  );
}

/**
 * Candidate tags keyed by name. Candidates are ALL `active` tags (ARCHITECTURE
 * §7 stage 0); tag names are globally unique (MODEL.md), so the map is a pure
 * label → tag lookup with no scope-collision handling left to do.
 */
function candidateTags(db: Database, bookmarkId: string): Map<string, Tag> {
  const map = new Map<string, Tag>();
  for (const tag of candidatesForBookmark(db, bookmarkId)) {
    map.set(tag.name, tag);
  }
  return map;
}

/**
 * Classifies one bookmark. Returns 'skipped' when classification is unavailable
 * (no client) or there is nothing to ask (no candidate tags) — a normal
 * degraded state, never an error (§1.5).
 */
export async function classifyBookmark(
  deps: ClassifyDeps,
  bookmarkId: string,
): Promise<ClassifyOutcome> {
  const { db, classifier, config } = deps;
  if (!classifier) {
    return { status: 'skipped', runs: 0, assigned: 0, retracted: 0, unknown: 0 };
  }
  const [bookmark] = getBookmarksWithTagsByIds(db, [bookmarkId]);
  if (!bookmark) {
    return { status: 'missing', runs: 0, assigned: 0, retracted: 0, unknown: 0 };
  }

  const candidates = candidateTags(db, bookmarkId);
  if (candidates.size === 0) {
    return { status: 'skipped', runs: 0, assigned: 0, retracted: 0, unknown: 0 };
  }

  const state = buildStateString(bookmark);
  const userTagIds = new Set(listUserTagIds(db, bookmarkId));
  const allNames = [...candidates.keys()];
  const outcome: ClassifyOutcome = {
    status: 'classified',
    runs: 0,
    assigned: 0,
    retracted: 0,
    unknown: 0,
  };
  /** Tags this pass qualified, across every batch run. */
  const qualifiedTagIds = new Set<string>();
  /** Runs created by this pass (the authoritative evidence for `selected`). */
  const runIds: string[] = [];

  /** Persists one result row and applies the assignment policy. */
  const recordResult = (runId: string, name: string, probability: number, rank: number): void => {
    const tag = candidates.get(name);
    if (!tag) {
      // The daemon answered a label we did not ask for (or a name vanished):
      // record it as durable evidence with no tag mapping (MODEL.md — unknown
      // labels never create vocabulary and never become assignments).
      console.warn(`[classify] unknown label from daemon: ${name}`);
      createUnknownClassificationLabel(db, { runId, rawLabel: name, probability });
      outcome.unknown += 1;
      return;
    }

    const qualifies =
      probability >= config.autoAssignThreshold &&
      tag.status === 'active' &&
      !userTagIds.has(tag.id);

    createClassificationResult(db, {
      runId,
      tagId: tag.id,
      probability,
      rank,
      selected: qualifies,
      rawLabel: name,
    });

    if (qualifies) {
      // assignTag never overwrites user/import rows (MODEL.md / ARCHITECTURE
      // §7 "User rows win"), so this is safe even if a user row appeared mid-run.
      assignTag(db, {
        bookmarkId,
        tagId: tag.id,
        source: 'classifier',
        confidence: probability,
        runId,
      });
      qualifiedTagIds.add(tag.id);
      outcome.assigned += 1;
    }
  };

  for (let offset = 0; offset < allNames.length; offset += MAX_QUESTIONS_PER_CALL) {
    const batch = allNames.slice(offset, offset + MAX_QUESTIONS_PER_CALL);
    // Batches run sequentially to pace the Ollaya daemon and keep run
    // creation ordering deterministic (classification_runs is append-only).
    // oxlint-disable-next-line no-await-in-loop
    const response = await classifier.decide({
      model: config.ollaya.model,
      state,
      questions: buildQuestions(batch),
    });

    const runId = createClassificationRun(db, {
      bookmarkId,
      classifier: 'ollaya',
      model: response.model ?? config.ollaya.model,
    });
    runIds.push(runId);
    outcome.runs += 1;

    const ranked = batch
      .map((name) => ({ name, probability: response.probabilities[name] ?? 0 }))
      .toSorted((a, b) => b.probability - a.probability);
    for (const [index, { name, probability }] of ranked.entries()) {
      recordResult(runId, name, probability, index + 1);
    }

    // Labels the daemon returned that we didn't ask about — these can never
    // be mapped to a tag (no row to point at) and never become an assignment;
    // they persist as evidence linked to the run (MODEL.md).
    for (const label of Object.keys(response.probabilities)) {
      if (!candidates.has(label)) {
        console.warn(`[classify] unknown label from daemon: ${label}`);
        createUnknownClassificationLabel(db, {
          runId,
          rawLabel: label,
          probability: response.probabilities[label] ?? 0,
        });
        outcome.unknown += 1;
      }
    }
  }

  // Recompute the effective state under the current policy (ARCHITECTURE §7
  // "Retraction"): retract classifier assignments this pass did not re-qualify
  // and reconcile `selected` flags — effective state only, evidence rows stay
  // immutable (MODEL.md principle 4). Runs after all batches so qualification
  // is the union across runs.
  outcome.retracted = reconcileClassifierAssignments(db, {
    bookmarkId,
    qualifiedTagIds: [...qualifiedTagIds],
    runIds,
  }).retracted;

  if (outcome.assigned > 0 || outcome.retracted > 0) {
    // Mirrors the (possibly changed) effective tags into the vector payload.
    const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
    await syncVectorPayload(deps.vector, bookmarkId, fresh);
  }
  return outcome;
}
