/**
 * Human review of classifier output. Accepting a below-threshold candidate
 * writes a user-sourced assignment (which the classifier can never overwrite or
 * retract — ARCHITECTURE §7 "User rows win") and mirrors it into the vector
 * payload.
 *
 * The review surface is classifier suggestions only (§7 stage 5): vocabulary is
 * created `active` by the importer and curated directly in the vocabulary UI,
 * and the classifier never creates vocabulary (MODEL.md principle 5), so there
 * are no proposals to triage.
 */

import type { Database } from 'bun:sqlite';

import {
  assignTag,
  getBookmarkById,
  getBookmarksWithTagsByIds,
  getTagById,
  listActiveTags,
  listBelowThresholdCandidates,
} from '@al-yo-bo/db';
import type { BookmarkWithTags, ReviewCandidate, Tag } from '@al-yo-bo/shared';

import type { CoreConfig } from '../config.ts';
import { NotFoundError } from '../errors.ts';
import type { EventsSink } from '../events.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import { bookmarkViewOrThrow } from './_views.ts';

export interface ReviewServiceDeps {
  db: Database;
  config: CoreConfig;
  vector: VectorProvider;
  events: EventsSink;
}

export interface ReviewService {
  /** Classifier-suggested tags below the auto-assign threshold. */
  listCandidates(): ReviewCandidate[];
  /** Active tags — the ones a suggestion can be accepted into. */
  listActiveTags(): Tag[];
  acceptCandidate(bookmarkId: string, tagId: string): Promise<BookmarkWithTags>;
}

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { db, config, vector, events } = deps;

  return {
    listCandidates() {
      return listBelowThresholdCandidates(db, config.autoAssignThreshold);
    },

    listActiveTags() {
      return listActiveTags(db);
    },

    async acceptCandidate(bookmarkId, tagId) {
      const bookmark = getBookmarkById(db, bookmarkId);
      if (!bookmark) {
        throw new NotFoundError('Bookmark not found');
      }
      const tag = getTagById(db, tagId);
      if (!tag) {
        throw new NotFoundError('Tag not found');
      }
      // Accepting writes `source='user'`: classifier re-runs skip user rows
      // entirely and retraction only removes `source='classifier'` rows
      // (MODEL.md / ARCHITECTURE §7).
      assignTag(db, { bookmarkId, tagId, source: 'user' });
      const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
      await syncVectorPayload(vector.current(), bookmarkId, fresh);
      events.emit({ topic: 'bookmarks.changed', bookmarkIds: [bookmarkId] });
      return bookmarkViewOrThrow(db, bookmarkId);
    },
  };
}
