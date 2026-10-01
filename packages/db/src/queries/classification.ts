import type { Database } from 'bun:sqlite';

import { bytesToUuid, newIdBytes, uuidToBytes, type Tag } from '@al-yo-bo/shared';

import { mapTag, type TagRow } from '../row-mapping.ts';

const TAG_COLUMNS = 'id, dataset_id, category_id, name, description, status, created_at';

export interface ClassificationRunInput {
  bookmarkId: string;
  /** Which classifier produced the run, e.g. 'ollaya'. */
  classifier: string;
  classifierVersion?: string | null;
  /** Model/checkpoint that answered, persisted for traceability (MODEL.md). */
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
 * Candidate set for classification (ARCHITECTURE §7 stage 0): active tags in the
 * bookmark's dataset. When the bookmark has a category, candidates are further
 * narrowed to that category's scope plus unscoped tags — still within the
 * dataset. Cross-dataset vocabulary is never a candidate.
 */
export function listActiveTagsForScope(
  db: Database,
  datasetId: string,
  categoryId: string | null,
): Tag[] {
  const datasetBytes = uuidToBytes(datasetId);
  const categoryBytes = categoryId ? uuidToBytes(categoryId) : null;
  return db
    .query<TagRow, [Uint8Array, Uint8Array | null, Uint8Array | null]>(
      `SELECT ${TAG_COLUMNS} FROM tags
        WHERE dataset_id = ? AND status = 'active'
          AND (? IS NULL OR category_id = ? OR category_id IS NULL)
        ORDER BY name`,
    )
    .all(datasetBytes, categoryBytes, categoryBytes)
    .map(mapTag);
}

/** Tag ids explicitly assigned by the user — classifier runs never touch these. */
export function listUserTagIds(db: Database, bookmarkId: string): string[] {
  return db
    .query<{ tag_id: Uint8Array }, [Uint8Array]>(
      "SELECT tag_id FROM bookmark_tags WHERE bookmark_id = ? AND source = 'user'",
    )
    .all(uuidToBytes(bookmarkId))
    .map((row) => bytesToUuid(row.tag_id));
}

/** Bookmarks in a tag's scope; an unscoped tag's scope is its whole dataset. */
export function listBookmarkIdsForCategoryScope(
  db: Database,
  datasetId: string,
  categoryId: string | null,
): string[] {
  return (
    categoryId
      ? db
          .query<{ id: Uint8Array }, [Uint8Array, Uint8Array]>(
            'SELECT id FROM bookmarks WHERE dataset_id = ? AND category_id = ?',
          )
          .all(uuidToBytes(datasetId), uuidToBytes(categoryId))
      : db
          .query<{ id: Uint8Array }, [Uint8Array]>('SELECT id FROM bookmarks WHERE dataset_id = ?')
          .all(uuidToBytes(datasetId))
  ).map((row) => bytesToUuid(row.id));
}

/** Inserts one classification run and returns its id (evidence is immutable). */
export function createClassificationRun(db: Database, input: ClassificationRunInput): string {
  const id = newIdBytes();
  db.query(
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
  db.query(
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
  db.query(
    `INSERT INTO unknown_classification_labels (id, run_id, raw_label, probability)
     VALUES (?, ?, ?, ?)`,
  ).run(newIdBytes(), uuidToBytes(input.runId), input.rawLabel, input.probability);
}

/** Unknown-label evidence rows for a run, highest probability first. */
export function listUnknownClassificationLabels(
  db: Database,
  runId: string,
): UnknownClassificationLabel[] {
  return db
    .query<
      { id: Uint8Array; run_id: Uint8Array; raw_label: string; probability: number; created_at: number },
      [Uint8Array]
    >(
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
