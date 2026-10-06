import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { bytesToUuid, uuidToBytes, type Tag } from '@al-yo-bo/shared';

import { newIdBytes } from '../uuid.ts';
import { prepared } from './statements.ts';
import { listActiveTags } from './tags.ts';

export interface ClassificationRunInput {
  bookmarkId: string;
  /** Which classifier produced the run, e.g. 'ollaya'. */
  classifier: string;
  classifierVersion?: string | null;
  /** Resolved checkpoint that answered, persisted for traceability (MODEL.md). */
  model?: string | null;
  confidence?: number | null;
}

/**
 * Candidate set for a classification pass (ARCHITECTURE §7 stage 0): ALL
 * active tags — tags have no category and there is no scoping axis (MODEL.md
 * principles 1-2). Kept bookmark-keyed because the classifier loop calls it
 * per bookmark; the parameter no longer narrows anything. The per-call cap
 * (batched `noul` questions) is the caller's concern, so this returns the
 * full set and core batches it.
 */
export function candidatesForBookmark(db: Database, _bookmarkId: string): Tag[] {
  return listActiveTags(db);
}

/** Tag ids explicitly assigned by the user — classifier runs never touch these. */
export function listUserTagIds(db: Database, bookmarkId: string): string[] {
  return prepared<{ tag_id: Uint8Array }, [Uint8Array]>(
    db,
    "SELECT tag_id FROM bookmark_tags WHERE bookmark_id = ? AND source = 'user'",
  )
    .all(uuidToBytes(bookmarkId))
    .map((row) => bytesToUuid(row.tag_id));
}

/** Inserts one classification run and returns its id (provenance anchor). */
export function createClassificationRun(db: Database, input: ClassificationRunInput): string {
  const id = newIdBytes();
  prepared(
    db,
    `INSERT INTO classification_runs (id, bookmark_id, classifier, classifier_version, model, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    uuidToBytes(input.bookmarkId),
    input.classifier,
    input.classifierVersion ?? null,
    input.model ?? null,
    input.confidence ?? null,
  );
  return bytesToUuid(id);
}

export interface ReconcileClassifierAssignmentsInput {
  bookmarkId: string;
  /** Tag ids the current pass qualified under the active policy. */
  qualifiedTagIds: string[];
}

export interface ReconcileClassifierAssignmentsResult {
  /** Classifier-sourced assignments removed because they no longer qualify. */
  retracted: number;
}

/**
 * Recomputes effective classifier state after a re-run (ARCHITECTURE §7 stage
 * 4 "Retraction").
 *
 * Classifier-sourced `bookmark_tags` rows the current pass did not re-qualify
 * are removed, so tags assigned under an older policy/threshold do not stick
 * forever. `user`/`import` rows win (MODEL.md / ARCHITECTURE §7): they are
 * never classifier-sourced, so they survive by construction.
 */
export function reconcileClassifierAssignments(
  db: Database,
  input: ReconcileClassifierAssignmentsInput,
): ReconcileClassifierAssignmentsResult {
  const bookmarkBytes = uuidToBytes(input.bookmarkId);
  const qualifiedBytes = input.qualifiedTagIds.map(uuidToBytes);

  const qualifiedList = qualifiedBytes.map(() => '?').join(', ');

  // Retract: `source = 'classifier'` keeps user/import rows intact.
  const deleteSql = qualifiedBytes.length
    ? `DELETE FROM bookmark_tags
        WHERE bookmark_id = ?
          AND source = 'classifier'
          AND tag_id NOT IN (${qualifiedList})`
    : `DELETE FROM bookmark_tags
        WHERE bookmark_id = ?
          AND source = 'classifier'`;
  const deleteParams: SQLQueryBindings[] = [bookmarkBytes, ...qualifiedBytes];

  const retracted = db.query<never, SQLQueryBindings[]>(deleteSql).run(...deleteParams).changes;

  return { retracted };
}
