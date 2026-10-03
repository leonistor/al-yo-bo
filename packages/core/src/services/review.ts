/**
 * Human review of classifier output. Accepting a below-threshold candidate
 * writes a user-sourced assignment (which the classifier can never overwrite)
 * and mirrors it into the vector payload.
 *
 * The vocabulary-review surface (accept/reject/rename/merge proposals) was
 * removed in Phase 0: the importer auto-creates vocabulary in its active state
 * at commit time and the classifier never creates vocabulary (MODEL.md
 * principle 5), so there are no `proposed` rows to triage.
 */

import type { Database } from 'bun:sqlite';

import {
  assignTag,
  getBookmarkById,
  getBookmarksWithTagsByIds,
  getTagById,
  listBelowThresholdCandidates,
  listTagsByStatus,
} from '@al-yo-bo/db';
import type { BookmarkWithTags, ReviewCandidate, Tag } from '@al-yo-bo/shared';

import type { CoreConfig } from '../config.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import { bookmarkViewOrThrow } from './_views.ts';

export interface ReviewServiceDeps {
  db: Database;
  config: CoreConfig;
  vector: VectorProvider;
  /** Dataset the review queues are scoped to. */
  datasetId: string;
}

export interface ReviewService {
  /** Classifier-suggested tags below the auto-assign threshold. */
  listCandidates(): ReviewCandidate[];
  /** Active tags still in scope for the user-curated vocabulary. */
  listActiveTags(): Tag[];
  acceptCandidate(bookmarkId: string, tagId: string): Promise<BookmarkWithTags>;
}

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { db, config, vector, datasetId } = deps;

  return {
    listCandidates() {
      return listBelowThresholdCandidates(db, datasetId, config.autoAssignThreshold);
    },

    listActiveTags() {
      return listTagsByStatus(db, datasetId, 'active');
    },

    async acceptCandidate(bookmarkId, tagId) {
      // Accepting is an assignment path, so the same dataset boundary applies:
      // both ids must resolve and belong to the review service's dataset.
      const bookmark = getBookmarkById(db, bookmarkId);
      if (!bookmark) {
        throw new NotFoundError('Bookmark not found');
      }
      const tag = getTagById(db, tagId);
      if (!tag) {
        throw new NotFoundError('Tag not found');
      }
      if (bookmark.datasetId !== datasetId || tag.datasetId !== datasetId) {
        throw new ValidationError('Candidate is outside this dataset');
      }
      assignTag(db, { bookmarkId, tagId, source: 'user' });
      const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
      await syncVectorPayload(vector.current(), bookmarkId, fresh);
      return bookmarkViewOrThrow(db, bookmarkId);
    },
  };
}
