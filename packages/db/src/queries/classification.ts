import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { bytesToUuid, uuidToBytes, type Tag } from '@al-yo-bo/shared';

import { newIdBytes } from '../uuid.ts';
import { prepared } from './statements.ts';
import { listActiveTags } from './tags.ts';

/**
 * Classification evidence (MODEL.md principles 4-5): runs, results, and
 * unknown labels are insert-only and immutable without exception — no code
 * path in this package UPDATEs their content. The single exception the model
 * allows is the policy-derived `selected` bit, reconciled by
 * `reconcileClassifierAssignments` (effective state, not evidence content).
 */

export interface ClassificationRunInput {
  bookmarkId: string;
  /** Which classifier produced the run, e.g. 'ollaya'. */
  classifier: string;
  classifierVersion?: string | null;
  /** Resolved checkpoint that answered, persisted for traceability (MODEL.md). */
  model?: string | null;
  confidence?: number | null;
}

export interface ClassificationResultInput {
  runId: string;
  tagId: string;
  probability: number;
  rank?: number | null;
  /** 1 when the assignment policy made this result effective. */
  selected?: boolean;
  /** The question label exactly as sent to the classifier. */
  rawLabel?: string | null;
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

/** Inserts one classification run and returns its id (evidence is immutable). */
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

/** Inserts one immutable result row for a run. */
export function createClassificationResult(db: Database, input: ClassificationResultInput): void {
  prepared(
    db,
    `INSERT INTO classification_results (id, run_id, tag_id, probability, rank, selected, raw_label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newIdBytes(),
    uuidToBytes(input.runId),
    uuidToBytes(input.tagId),
    input.probability,
    input.rank ?? null,
    input.selected ? 1 : 0,
    input.rawLabel ?? null,
  );
}

export interface UnknownClassificationLabelInput {
  runId: string;
  /** The classifier label verbatim — it matched no candidate tag. */
  rawLabel: string;
  probability: number;
}

export interface UnknownClassificationLabel {
  id: string;
  runId: string;
  rawLabel: string;
  probability: number;
  createdAt: number;
}

/**
 * Inserts one immutable unknown-label evidence row (MODEL.md: unknown labels
 * never create vocabulary and never become assignments). No uniqueness
 * constraint — repeated occurrences are separate evidence rows.
 */
export function createUnknownClassificationLabel(
  db: Database,
  input: UnknownClassificationLabelInput,
): void {
  prepared(
    db,
    `INSERT INTO unknown_classification_labels (id, run_id, raw_label, probability)
     VALUES (?, ?, ?, ?)`,
  ).run(newIdBytes(), uuidToBytes(input.runId), input.rawLabel, input.probability);
}

export interface ReconcileClassifierAssignmentsInput {
  bookmarkId: string;
  /** Tag ids the current pass qualified under the active policy. */
  qualifiedTagIds: string[];
  /** Run ids created by the current pass — the latest evidence for each tag. */
  runIds: string[];
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
 * never classifier-sourced, so they survive by construction. The current
 * pass's `classification_results.selected` flags become authoritative: any
 * older selected flag for this bookmark is unset. Result rows themselves stay
 * immutable — only the policy-derived `selected` bit is reconciled (MODEL.md
 * principle 4).
 */
export function reconcileClassifierAssignments(
  db: Database,
  input: ReconcileClassifierAssignmentsInput,
): ReconcileClassifierAssignmentsResult {
  const bookmarkBytes = uuidToBytes(input.bookmarkId);
  const qualifiedBytes = input.qualifiedTagIds.map(uuidToBytes);
  const runBytes = input.runIds.map(uuidToBytes);

  const qualifiedList = qualifiedBytes.map(() => '?').join(', ');
  const runList = runBytes.map(() => '?').join(', ');

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

  // Reconcile `selected`: only a result from this pass whose tag qualified stays
  // selected; every older selected flag for the bookmark is cleared.
  const keepCurrent =
    qualifiedBytes.length && runBytes.length
      ? `NOT (tag_id IN (${qualifiedList}) AND run_id IN (${runList}))`
      : null;
  const selectedSql = `UPDATE classification_results SET selected = 0
      WHERE run_id IN (SELECT id FROM classification_runs WHERE bookmark_id = ?)
        AND selected = 1${keepCurrent ? ` AND ${keepCurrent}` : ''}`;
  const selectedParams: SQLQueryBindings[] = keepCurrent
    ? [bookmarkBytes, ...qualifiedBytes, ...runBytes]
    : [bookmarkBytes];
  db.query<never, SQLQueryBindings[]>(selectedSql).run(...selectedParams);

  return { retracted };
}

/** Unknown-label evidence rows for a run, highest probability first. */
export function listUnknownClassificationLabels(
  db: Database,
  runId: string,
): UnknownClassificationLabel[] {
  return prepared<
    {
      id: Uint8Array;
      run_id: Uint8Array;
      raw_label: string;
      probability: number;
      created_at: number;
    },
    [Uint8Array]
  >(
    db,
    `SELECT id, run_id, raw_label, probability, created_at
         FROM unknown_classification_labels
        WHERE run_id = ?
        ORDER BY probability DESC, raw_label`,
  )
    .all(uuidToBytes(runId))
    .map((row) => ({
      id: bytesToUuid(row.id),
      runId: bytesToUuid(row.run_id),
      rawLabel: row.raw_label,
      probability: row.probability,
      createdAt: row.created_at,
    }));
}
