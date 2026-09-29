import type { Database } from 'bun:sqlite';

import { bytesToUuid, type ReviewCandidate, type Tag } from '@al-yo-bo/shared';

import { mapTag, type TagRow } from '../row-mapping.ts';

interface CandidateRow {
  bookmark_id: Uint8Array;
  url: string;
  title: string | null;
  tag_id: Uint8Array;
  name: string;
  probability: number;
  run_id: Uint8Array;
}

/** Proposed tags awaiting approval (MODEL.md: proposed -> active/deprecated). */
export function listProposedTags(db: Database): Tag[] {
  return db
    .query<TagRow, []>(
      `SELECT id, category_id, name, description, status, created_at
         FROM tags WHERE status = 'proposed' ORDER BY name`,
    )
    .all()
    .map(mapTag);
}

/**
 * Classifier suggestions below the auto-assign threshold: retained as evidence
 * and surfaced for the user to accept (which writes a user-sourced assignment).
 */
export function listBelowThresholdCandidates(
  db: Database,
  threshold: number,
  limit = 50,
): ReviewCandidate[] {
  return db
    .query<CandidateRow, [number, number]>(
      `SELECT r.bookmark_id AS bookmark_id, b.url AS url, b.title AS title,
              cr.tag_id AS tag_id, t.name AS name, cr.probability AS probability, cr.run_id AS run_id
         FROM classification_results cr
         JOIN classification_runs r ON r.id = cr.run_id
         JOIN bookmarks b ON b.id = r.bookmark_id
         JOIN tags t ON t.id = cr.tag_id
        WHERE cr.selected = 0 AND cr.probability < ? AND t.status = 'active'
        ORDER BY cr.probability DESC
        LIMIT ?`,
    )
    .all(threshold, limit)
    .map((row) => ({
      bookmarkId: bytesToUuid(row.bookmark_id),
      bookmarkUrl: row.url,
      bookmarkTitle: row.title,
      tagId: bytesToUuid(row.tag_id),
      tagName: row.name,
      probability: row.probability,
      runId: bytesToUuid(row.run_id),
    }));
}
