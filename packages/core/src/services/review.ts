import type { Database } from 'bun:sqlite';

import {
  assignTag,
  getBookmarksWithTagsByIds,
  getCategoryById,
  getSectionById,
  getTagById,
  listBelowThresholdCandidates,
  listProposedTags,
  setCategoryStatus,
  setSectionStatus,
  setTagStatus,
  updateCategory,
  updateSection,
  updateTag,
} from '@al-yo-bo/db';
import type {
  BookmarkWithTags,
  Category,
  ReviewCandidate,
  Section,
  Tag,
  VocabularyProposal,
} from '@al-yo-bo/shared';
import { uuidToBytes } from '@al-yo-bo/shared';

import type { CoreConfig } from '../config.ts';
import type { VectorProvider } from '../vector/provider.ts';
import { syncVectorPayload } from '../vector/sync.ts';
import { bookmarkViewOrThrow } from './_views.ts';

export type ProposalKind = VocabularyProposal['kind'];

export interface ReviewServiceDeps {
  db: Database;
  config: CoreConfig;
  vector: VectorProvider;
  /** Dataset the review queues are scoped to. */
  datasetId: string;
}

export interface ReviewService {
  listProposedTags(): Tag[];
  listCandidates(): ReviewCandidate[];
  acceptCandidate(bookmarkId: string, tagId: string): Promise<BookmarkWithTags>;
  /** Vocabulary review (ARCHITECTURE §7 Stage 5): accept/reject/rename/merge. */
  acceptProposal(kind: ProposalKind, id: string): void;
  rejectProposal(kind: ProposalKind, id: string): void;
  renameProposal(kind: ProposalKind, id: string, name: string): void;
  mergeProposal(kind: ProposalKind, id: string, intoId: string): void;
}

/**
 * Human review of classifier output and proposed vocabulary. Accepting a
 * below-threshold candidate writes a user-sourced assignment (which the
 * classifier can never overwrite) and mirrors it into the vector payload.
 * Vocabulary actions resolve `proposed` sections/categories/tags; rejecting
 * records `merged_into_id` so re-imports resolve the name silently.
 */
export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { db, config, vector, datasetId } = deps;

  function requireSection(id: string): Section {
    const section = getSectionById(db, id);
    if (!section) {
      throw new Error('Section not found');
    }
    return section;
  }

  function requireCategory(id: string): Category {
    const category = getCategoryById(db, id);
    if (!category) {
      throw new Error('Category not found');
    }
    return category;
  }

  function requireTag(id: string): Tag {
    const tag = getTagById(db, id);
    if (!tag) {
      throw new Error('Tag not found');
    }
    return tag;
  }

  return {
    listProposedTags() {
      return listProposedTags(db, datasetId);
    },

    listCandidates() {
      return listBelowThresholdCandidates(db, datasetId, config.autoAssignThreshold);
    },

    async acceptCandidate(bookmarkId, tagId) {
      assignTag(db, { bookmarkId, tagId, source: 'user' });
      const [fresh] = getBookmarksWithTagsByIds(db, [bookmarkId]);
      await syncVectorPayload(vector.current(), bookmarkId, fresh);
      return bookmarkViewOrThrow(db, bookmarkId);
    },

    acceptProposal(kind, id) {
      switch (kind) {
        case 'section':
          setSectionStatus(db, id, 'active');
          break;
        case 'category':
          setCategoryStatus(db, id, 'active');
          break;
        case 'tag':
          setTagStatus(db, id, 'active');
          break;
      }
    },

    rejectProposal(kind, id) {
      switch (kind) {
        case 'section':
          setSectionStatus(db, id, 'rejected');
          break;
        case 'category':
          setCategoryStatus(db, id, 'rejected');
          break;
        case 'tag':
          setTagStatus(db, id, 'rejected');
          break;
      }
    },

    renameProposal(kind, id, name) {
      switch (kind) {
        case 'section':
          updateSection(db, id, { name });
          break;
        case 'category':
          updateCategory(db, id, { name });
          break;
        case 'tag':
          updateTag(db, id, { name });
          break;
      }
    },

    mergeProposal(kind, id, intoId) {
      switch (kind) {
        case 'section': {
          const target = requireSection(intoId);
          requireSection(id);
          // Point the rejected section at its target and move its categories.
          updateSection(db, id, { mergedIntoId: target.id });
          setSectionStatus(db, id, 'rejected');
          db.query('UPDATE categories SET section_id = ? WHERE section_id = ?').run(
            uuidToBytes(target.id),
            uuidToBytes(id),
          );
          break;
        }
        case 'category': {
          const target = requireCategory(intoId);
          requireCategory(id);
          updateCategory(db, id, { mergedIntoId: target.id });
          setCategoryStatus(db, id, 'rejected');
          // Re-home bookmarks and scoped tags onto the target category.
          db.query('UPDATE bookmarks SET category_id = ? WHERE category_id = ?').run(
            uuidToBytes(target.id),
            uuidToBytes(id),
          );
          db.query('UPDATE tags SET category_id = ? WHERE category_id = ?').run(
            uuidToBytes(target.id),
            uuidToBytes(id),
          );
          break;
        }
        case 'tag': {
          const target = requireTag(intoId);
          requireTag(id);
          updateTag(db, id, { mergedIntoId: target.id });
          setTagStatus(db, id, 'rejected');
          // Re-home effective assignments onto the target tag.
          db.query('UPDATE bookmark_tags SET tag_id = ? WHERE tag_id = ?').run(
            uuidToBytes(target.id),
            uuidToBytes(id),
          );
          break;
        }
      }
    },
  };
}
