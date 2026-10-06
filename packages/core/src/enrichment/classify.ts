/**
 * Classification workflow (ARCHITECTURE §7): build a state string from the
 * bookmark, ask one batched `noul` question per candidate tag, persist one
 * `classification_runs` row per decide call, then apply the deterministic
 * assignment policy (probability ≥ threshold AND tag active AND not
 * user-assigned).
 *
 * Ollaya is optional (§1.5): without a classifier client this degrades to a
 * no-op — bookmarks stay browsable, searchable and manually taggable.
 *
 * Candidate set (decided, §7 stage 0): ALL `active` tags — tags have no
 * category and there is no scoping axis left (MODEL.md principles 1-2). The
 * per-call cap below keeps run size bounded; candidate-set precision as the
 * vocabulary grows is a §13 revisit trigger.
 *
 * The classifier never creates vocabulary (MODEL.md principle 5). Unknown
 * labels returned by the daemon are logged with `console.warn` and counted for
 * observability, but they never become assignments or vocabulary rows.
 */

import type { Database } from 'bun:sqlite';

import type { ClassifierClient, NoulQuestion } from '@al-yo-bo/ai';
import {
  assignTag,
  candidatesForBookmark,
  createClassificationRun,
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
  /** Unknown labels the daemon returned (logged, never persisted). */
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
  let runId = '';

  /** Applies the assignment policy for one daemon answer. */
  const recordResult = (name: string, probability: number): void => {
    const tag = candidates.get(name);
    if (!tag) {
      // The daemon answered a label we did not ask for (or a name vanished).
      console.warn(`[classify] unknown label from daemon: ${name}`);
      outcome.unknown += 1;
      return;
    }

    const qualifies =
      probability >= config.autoAssignThreshold &&
      tag.status === 'active' &&
      !userTagIds.has(tag.id);

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

    runId = createClassificationRun(db, {
      bookmarkId,
      classifier: 'ollaya',
      model: response.model ?? config.ollaya.model,
    });
    outcome.runs += 1;

    const ranked = batch
      .map((name) => ({ name, probability: response.probabilities[name] ?? 0 }))
      .toSorted((a, b) => b.probability - a.probability);
    for (const { name, probability } of ranked) {
      recordResult(name, probability);
    }

    // Labels the daemon returned that we didn't ask about can never be mapped
    // to a tag (no row to point at) and never become an assignment.
    for (const label of Object.keys(response.probabilities)) {
      if (!candidates.has(label)) {
        console.warn(`[classify] unknown label from daemon: ${label}`);
        outcome.unknown += 1;
      }
    }
  }

  // Recompute the effective state under the current policy (ARCHITECTURE §7
  // "Retraction"): retract classifier assignments this pass did not re-qualify.
  // User/import rows survive by construction because they are never
  // source='classifier'.
  outcome.retracted = reconcileClassifierAssignments(db, {
    bookmarkId,
    qualifiedTagIds: [...qualifiedTagIds],
  }).retracted;

  if (outcome.assigned > 0 || outcome.retracted > 0) {
    // Mirrors the (possibly changed) effective tags into the vector payload.
    const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
    await syncVectorPayload(deps.vector, bookmarkId, fresh);
  }
  return outcome;
}
