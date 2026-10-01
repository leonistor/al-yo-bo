import type { Database } from 'bun:sqlite';

import {
  createImportBatch,
  deleteImportBatch,
  getImportBatchById,
  listStagedBatches,
  setImportBatchStatus,
} from '@al-yo-bo/db';
import { ingestBookmarks, parseCollection, resolveVocabulary } from '@al-yo-bo/importer';
import type { ImportReport, ImportedBookmark, VocabularyProposal } from '@al-yo-bo/shared';
import { uuidToBytes } from '@al-yo-bo/shared';

import type { JobScheduler } from './enrichment.ts';

export interface ImportPreview {
  parsed: number;
  skipped: number;
  bookmarks: ImportedBookmark[];
}

export interface ImportOptions {
  file?: string;
}

/** A staged import batch and the vocabulary proposals awaiting review for it. */
export interface StagedBatch {
  id: string;
  file: string | null;
  bookmarkCount: number;
  proposals: VocabularyProposal[];
}

export interface ImportServiceDeps {
  db: Database;
  jobs: JobScheduler;
}

export interface ImportService {
  preview(markdown: string): ImportPreview;
  /** Two-phase import: resolves vocabulary; stages when proposals exist. */
  import(markdown: string, datasetId: string, options?: ImportOptions): ImportReport;
  /** Commits a staged batch after review resolved its proposals. */
  commit(batchId: string): ImportReport;
  /** Discards a staged batch and its still-proposed vocabulary. */
  discard(batchId: string): void;
  /** Staged batches with their proposals, for the vocabulary review page. */
  listStaged(datasetId: string): StagedBatch[];
}

/**
 * Markdown collection import (ARCHITECTURE §7 Stage 1). Preview never writes.
 * Import resolves the file's vocabulary against the dataset: when every name
 * resolves to existing vocabulary the import commits immediately; when anything
 * is new, the batch is staged in `import_batches` and committed later by the
 * review flow (after the proposed vocabulary is accepted/merged/rejected).
 */
export function createImportService(deps: ImportServiceDeps): ImportService {
  const { db, jobs } = deps;

  function enqueueScrapes(report: ImportReport): ImportReport {
    for (const id of report.addedIds) {
      jobs.enqueue(id, 'scrape');
    }
    return report;
  }

  return {
    preview(markdown) {
      const { bookmarks, skipped } = parseCollection(markdown);
      return { parsed: bookmarks.length, skipped, bookmarks };
    },

    import(markdown, datasetId, options = {}) {
      const { bookmarks, skipped } = parseCollection(markdown);
      const resolution = resolveVocabulary(db, datasetId, bookmarks);

      // Nothing new: commit immediately, fully automatic.
      if (resolution.proposals.length === 0) {
        const report = ingestBookmarks(db, datasetId, bookmarks, resolution, {
          file: options.file,
          skipped,
        });
        return enqueueScrapes(report);
      }

      // New vocabulary proposed: stage the batch for review.
      const batch = createImportBatch(db, {
        datasetId,
        file: options.file,
        bookmarks,
      });
      return {
        added: 0,
        updated: 0,
        skipped,
        categoriesCreated: 0,
        tagsAssigned: 0,
        parsed: bookmarks.length,
        bookmarks,
        addedIds: [],
        staged: true,
        batchId: batch.id,
        proposals: resolution.proposals,
      };
    },

    commit(batchId) {
      const batch = getImportBatchById(db, batchId);
      if (!batch) {
        throw new Error(`Import batch ${batchId} not found`);
      }
      if (batch.status !== 'staged') {
        throw new Error(`Import batch ${batchId} is ${batch.status}, not staged`);
      }
      // Re-resolve: the review flow may have accepted/merged/rejected the
      // proposed vocabulary since staging. Remaining proposals mean the review
      // is incomplete — refuse to commit.
      const resolution = resolveVocabulary(db, batch.datasetId, batch.bookmarks);
      if (resolution.proposals.length > 0) {
        throw new Error(
          `Import batch ${batchId} still has unresolved vocabulary: ${resolution.proposals
            .map((p) => `${p.kind} "${p.name}"`)
            .join(', ')}`,
        );
      }
      const report = ingestBookmarks(db, batch.datasetId, batch.bookmarks, resolution, {
        file: batch.file ?? undefined,
      });
      setImportBatchStatus(db, batchId, 'committed');
      return enqueueScrapes(report);
    },

    discard(batchId) {
      const batch = getImportBatchById(db, batchId);
      if (!batch) {
        throw new Error(`Import batch ${batchId} not found`);
      }
      // Delete the still-proposed vocabulary this batch created, then the batch.
      for (const name of new Set(
        batch.bookmarks.flatMap((b) => [b.category, b.subsection, ...b.tags]),
      )) {
        if (!name) {
          continue;
        }
        deleteProposedByName(db, batch.datasetId, name);
      }
      deleteImportBatch(db, batchId);
    },

    listStaged(datasetId) {
      return listStagedBatches(db, datasetId).map((batch) => {
        // Re-resolve the batch's stored bookmarks: proposals are the names that
        // still have no active entry (the review flow may have resolved some).
        const resolution = resolveVocabulary(db, batch.datasetId, batch.bookmarks);
        return {
          id: batch.id,
          file: batch.file,
          bookmarkCount: batch.bookmarks.length,
          proposals: resolution.proposals,
        };
      });
    },
  };
}

function deleteProposedByName(db: Database, datasetId: string, name: string): void {
  db.query(`DELETE FROM sections WHERE dataset_id = ? AND name = ? AND status = 'proposed'`).run(
    uuidToBytes(datasetId),
    name,
  );
  db.query(`DELETE FROM categories WHERE dataset_id = ? AND name = ? AND status = 'proposed'`).run(
    uuidToBytes(datasetId),
    name,
  );
  db.query(
    `DELETE FROM tags WHERE dataset_id = ? AND name = ? AND category_id IS NULL AND status = 'proposed'`,
  ).run(uuidToBytes(datasetId), name);
}
