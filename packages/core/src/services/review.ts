import type { Database } from 'bun:sqlite';

import {
  assignTag,
  getBookmarksWithTagsByIds,
  listBelowThresholdCandidates,
  listProposedTags,
} from '@al-yo-bo/db';
import type { BookmarkWithTags, ReviewCandidate, Tag } from '@al-yo-bo/shared';

import type { CoreConfig } from '../config.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import { bookmarkViewOrThrow } from './_views.ts';

export interface ReviewServiceDeps {
  db: Database;
  config: CoreConfig;
  vector: VectorProvider;
}

export interface ReviewService {
  listProposedTags(): Tag[];
  listCandidates(): ReviewCandidate[];
  acceptCandidate(bookmarkId: string, tagId: string): Promise<BookmarkWithTags>;
}

/**
 * Human review of classifier output: proposed tags and below-threshold
 * suggestions. Accepting writes a user-sourced assignment (which the classifier
 * can never overwrite) and mirrors it into the vector payload.
 */
export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { db, config, vector } = deps;

  return {
    listProposedTags() {
      return listProposedTags(db);
    },

    listCandidates() {
      return listBelowThresholdCandidates(db, config.autoAssignThreshold);
    },

    async acceptCandidate(bookmarkId, tagId) {
      assignTag(db, { bookmarkId, tagId, source: 'user' });
      const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
      await syncVectorPayload(vector.current(), bookmarkId, fresh);
      return bookmarkViewOrThrow(db, bookmarkId);
    },
  };
}
