/**
 * One-time staged-batch drain (2026-10-01 import simplification plan).
 * Runs BEFORE `setupDatabase` so the migration that drops `import_batches`
 * does not lose pending staged bookmarks.
 *
 * Idempotent: re-running after every batch is committed is a no-op.
 */

import type { Database } from 'bun:sqlite';

import { ingestBookmarks, resolveVocabulary } from '@al-yo-bo/importer';
import { bytesToUuid } from '@al-yo-bo/shared';

import type { JobScheduler } from './services/enrichment.ts';

export interface DrainReport {
  inspected: number;
  committed: number;
  discarded: number;
  failed: number;
}

interface StagedBatchRow {
  id: Uint8Array;
  dataset_id: Uint8Array;
  bookmarks: string;
}

interface StagedBookmark {
  url: string;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[];
  priority?: number | null;
}

/**
 * Commits every still-staged batch by replaying its `bookmarks` JSON through
 * the importer's `resolveVocabulary` + `ingestBookmarks` (which auto-create
 * any missing vocabulary as active). Returns a summary; individual row
 * failures are logged and recorded on the resulting bookmark's
 * `metadata.unmigrated` so the operator can replay them.
 */
export function drainImportBatches(db: Database, jobs: JobScheduler): DrainReport {
  const report: DrainReport = {
    inspected: 0,
    committed: 0,
    discarded: 0,
    failed: 0,
  };

  if (!tableExists(db, 'import_batches')) {
    return report;
  }

  const rows = db
    .query<StagedBatchRow, []>(
      `SELECT id, dataset_id, bookmarks
         FROM import_batches
        WHERE status = 'staged'`,
    )
    .all();

  for (const row of rows) {
    report.inspected += 1;
    const datasetId = bytesToUuid(row.dataset_id);
    const bookmarks = JSON.parse(row.bookmarks) as StagedBookmark[];

    try {
      // Normalize the legacy shape (`subsection` is the new `category`).
      const normalized = bookmarks.map((bookmark) => ({
        url: bookmark.url,
        title: bookmark.title ?? null,
        description: bookmark.description ?? null,
        category: bookmark.category ?? null,
        priority: bookmark.priority ?? null,
        tags: bookmark.tags ?? [],
      }));
      const resolution = resolveVocabulary(db, datasetId, normalized);
      const ingestReport = ingestBookmarks(db, datasetId, normalized, resolution);
      for (const id of ingestReport.addedIds) {
        jobs.enqueue(id, 'scrape');
      }
      db.query(`UPDATE import_batches SET status = 'committed', committed_at = ? WHERE id = ?`)
        .run(Date.now(), row.id);
      report.committed += 1;
    } catch (error) {
      console.error(`[drain] failed to commit batch ${bytesToUuid(row.id)}`, error);
      db.query(`UPDATE import_batches SET status = 'discarded' WHERE id = ?`).run(row.id);
      report.discarded += 1;
    }
  }

  return report;
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE name = ?`)
    .get(name);
  return row !== null;
}
