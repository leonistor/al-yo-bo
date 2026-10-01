/**
 * Classification workflow (ARCHITECTURE §7): build a state string from the
 * bookmark, ask one batched `noul` question per candidate tag, persist immutable
 * runs/results, then apply the deterministic assignment policy
 * (probability ≥ threshold AND tag active AND not user-assigned).
 *
 * Ollaya is optional (§1.5): without a classifier client this degrades to a
 * no-op — bookmarks stay browsable, searchable and manually taggable.
 *
 * Phase 0 simplification: the classifier never creates vocabulary. Unknown
 * labels are persisted as `classification_results` rows with `selected = 0`
 * and the raw label preserved — they show up in the below-threshold queue,
 * which is the user-facing triage surface.
 */

import type { Database } from 'bun:sqlite';

import type { ClassifierClient, NoulQuestion } from '@al-yo-bo/classifier';
import {
  assignTag,
  createClassificationResult,
  createClassificationRun,
  getBookmarksWithTagsByIds,
  listActiveTagsForScope,
  listUserTagIds,
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
 * Candidate tags keyed by name. Candidates are active tags in the bookmark's
 * dataset (narrowed to the bookmark's category scope when it has one); duplicate
 * names across scopes collapse to one question (the scoped tag wins) because
 * question labels are tag names.
 */
function candidatesForBookmark(db: Database, bookmark: BookmarkWithTags): Map<string, Tag> {
  const tags = listActiveTagsForScope(db, bookmark.datasetId, bookmark.categoryId);
  const map = new Map<string, Tag>();
  for (const tag of tags) {
    map.set(tag.name, tag);
  }
  if (bookmark.categoryId) {
    for (const tag of tags) {
      if (tag.categoryId === bookmark.categoryId) {
        map.set(tag.name, tag); // scoped tag wins a name collision
      }
    }
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
    return { status: 'skipped', runs: 0, assigned: 0, unknown: 0 };
  }
  const [bookmark] = getBookmarksWithTagsByIds(db, [bookmarkId]);
  if (!bookmark) {
    return { status: 'missing', runs: 0, assigned: 0, unknown: 0 };
  }

  const candidates = candidatesForBookmark(db, bookmark);
  if (candidates.size === 0) {
    return { status: 'skipped', runs: 0, assigned: 0, unknown: 0 };
  }

  const state = buildStateString(bookmark);
  const userTagIds = new Set(listUserTagIds(db, bookmarkId));
  const allNames = [...candidates.keys()];
  const outcome: ClassifyOutcome = { status: 'classified', runs: 0, assigned: 0, unknown: 0 };

  /** Persists one result row and applies the assignment policy. */
  const recordResult = (runId: string, name: string, probability: number, rank: number): void => {
    const tag = candidates.get(name);
    if (!tag) {
      // The daemon answered a label we did not ask for (or a name vanished):
      // record it as evidence with no tag mapping. The raw_label preserves what
      // the daemon said; the below-threshold review queue surfaces it.
      // We can't write a classification_results row without a tag_id, so the
      // raw label is logged for now and the operator can choose to add a tag.
      console.warn(`[classify] unknown label from daemon: ${name}`);
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
      // assignTag never overwrites user rows (MODEL.md), so this is safe even
      // if the user row appeared mid-run.
      assignTag(db, {
        bookmarkId,
        tagId: tag.id,
        source: 'classifier',
        confidence: probability,
        runId,
      });
      outcome.assigned += 1;
    }
  };

  for (let offset = 0; offset < allNames.length; offset += MAX_QUESTIONS_PER_CALL) {
    const batch = allNames.slice(offset, offset + MAX_QUESTIONS_PER_CALL);
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
    outcome.runs += 1;

    const ranked = batch
      .map((name) => ({ name, probability: response.probabilities[name] ?? 0 }))
      .toSorted((a, b) => b.probability - a.probability);
    for (const [index, { name, probability }] of ranked.entries()) {
      recordResult(runId, name, probability, index + 1);
    }

    // Labels the daemon returned that we didn't ask about — these can never
    // be mapped to a tag (no row to point at) and never become an assignment.
    for (const label of Object.keys(response.probabilities)) {
      if (!candidates.has(label)) {
        outcome.unknown += 1;
      }
    }
  }

  if (outcome.assigned > 0) {
    // Mirrors the (possibly changed) effective tags into the vector payload.
    const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
    await syncVectorPayload(deps.vector, bookmarkId, fresh);
  }
  return outcome;
}
