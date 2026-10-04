import type { Database } from 'bun:sqlite';

import { bytesToUuid, type ReviewCandidate } from '@al-yo-bo/shared';

import { prepared } from './statements.ts';

interface CandidateRow {
  bookmark_id: Uint8Array;
  url: string;
  title: string | null;
  tag_id: Uint8Array;
  name: string;
  probability: number;
  run_id: Uint8Array;
}

/**
 * Classifier suggestions below the auto-assign threshold: retained as evidence
 * and surfaced for the user to accept (which writes a user-sourced assignment,
 * ARCHITECTURE §7 stage 5).
 *
 * Two hygiene rules keep the queue from growing stale:
 * - a (bookmark, tag) pair that already has a `bookmark_tags` row is excluded —
 *   accepting a candidate clears it from the queue immediately;
 * - only the newest run's result per (bookmark, tag) pair is considered, so a
 *   re-run replaces the old below-threshold suggestion instead of piling a
 *   second row on top of it.
 */
export function listBelowThresholdCandidates(
  db: Database,
  threshold: number,
  limit = 50,
): ReviewCandidate[] {
  return prepared<CandidateRow, [number, number]>(
    db,
    `WITH latest AS (
       SELECT r.bookmark_id AS bookmark_id, b.url AS url, b.title AS title,
              cr.tag_id AS tag_id, t.name AS name, cr.probability AS probability,
              cr.run_id AS run_id, cr.selected AS selected,
              ROW_NUMBER() OVER (
                PARTITION BY r.bookmark_id, cr.tag_id
                ORDER BY r.created_at DESC, r.id DESC
              ) AS rn
         FROM classification_results cr
         JOIN classification_runs r ON r.id = cr.run_id
         JOIN bookmarks b ON b.id = r.bookmark_id
         JOIN tags t ON t.id = cr.tag_id
        WHERE t.status = 'active'
     )
     SELECT bookmark_id, url, title, tag_id, name, probability, run_id
       FROM latest
      WHERE rn = 1 AND selected = 0 AND probability < ?
        AND NOT EXISTS (
          SELECT 1 FROM bookmark_tags bt
           WHERE bt.bookmark_id = latest.bookmark_id AND bt.tag_id = latest.tag_id
        )
      ORDER BY probability DESC
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
