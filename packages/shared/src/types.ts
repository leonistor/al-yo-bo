export type TagStatus = 'active' | 'proposed' | 'deprecated' | 'rejected';

export type CategoryStatus = 'active' | 'proposed' | 'rejected';

export type BookmarkStatus = 'active' | 'invalid';

export type BookmarkListStatus = BookmarkStatus | 'all';

export type AssignmentSource = 'classifier' | 'user' | 'import';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export type BookmarkSort = 'created_at' | 'updated_at' | 'title';

export type ImportBatchStatus = 'staged' | 'committed' | 'discarded';

export interface Dataset {
  id: string;
  name: string;
  createdAt: number;
}

export interface Section {
  id: string;
  datasetId: string;
  name: string;
  description: string | null;
  status: 'active' | 'proposed' | 'rejected';
  mergedIntoId: string | null;
  createdAt: number;
}

export interface Category {
  id: string;
  datasetId: string;
  sectionId: string | null;
  name: string;
  description: string | null;
  status: CategoryStatus;
  mergedIntoId: string | null;
  createdAt: number;
}

export interface Tag {
  id: string;
  datasetId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  status: TagStatus;
  mergedIntoId: string | null;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  datasetId: string;
  url: string;
  title: string | null;
  description: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  categoryId: string | null;
  contentHash: string | null;
  scrapedAt: number | null;
  status: BookmarkStatus;
  scrapeAttempts: number;
  createdAt: number;
  updatedAt: number;
}

/** A tag as attached to a bookmark, including provenance. */
export interface BookmarkTagView {
  tagId: string;
  name: string;
  source: AssignmentSource;
  confidence: number | null;
}

export interface BookmarkWithTags extends Bookmark {
  tags: BookmarkTagView[];
}

export interface CategoryAggregate {
  id: string;
  name: string;
  sectionId: string | null;
  count: number;
}

export interface SectionAggregate {
  id: string;
  name: string;
  count: number;
}

export interface TagAggregate {
  id: string;
  name: string;
  status: TagStatus;
  count: number;
}

export interface Aggregates {
  total: number;
  invalidCount: number;
  sections: SectionAggregate[];
  categories: CategoryAggregate[];
  tags: TagAggregate[];
}

/** A single ranked hit before fusion; `score` is raw (BM25/dot-product) and only used for ordering. */
export interface RankedCandidate {
  bookmarkId: string;
  rank: number;
  score: number;
  snippet?: string;
}

export interface SearchQuery {
  q?: string;
  mode?: SearchMode;
  datasetId?: string;
  categoryId?: string;
  tagId?: string;
  dateFrom?: number;
  dateTo?: number;
  status?: BookmarkListStatus;
  sort?: BookmarkSort;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface Pagination {
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SearchResponse {
  items: BookmarkWithTags[];
  total: number;
  mode: SearchMode;
  pagination: Pagination;
}

export interface BookmarkListResponse {
  items: BookmarkWithTags[];
  total: number;
  pagination: Pagination;
}

export interface ImportedBookmark {
  url: string;
  title: string | null;
  description: string | null;
  category: string | null;
  subsection: string | null;
  priority: number | null;
  /** Frontmatter-derived tag names; `[]` when the file has no frontmatter tags. */
  tags: string[];
}

export interface ReviewCandidate {
  bookmarkId: string;
  bookmarkUrl: string;
  bookmarkTitle: string | null;
  tagId: string;
  tagName: string;
  probability: number;
  runId: string;
}

/** A vocabulary name the import could not resolve to an active entry. */
export interface VocabularyProposal {
  kind: 'section' | 'category' | 'tag';
  /** Entity id of the `proposed` row (for review actions). */
  id: string;
  name: string;
  /** Raw source context: H2 heading (section/category) or frontmatter tag. */
  source: string;
  /** Number of bookmarks in the batch that reference this proposal. */
  count: number;
}

export interface ImportReport {
  added: number;
  updated: number;
  skipped: number;
  categoriesCreated: number;
  /** Count of tag assignments made by the import. */
  tagsAssigned: number;
  parsed: number;
  bookmarks: ImportedBookmark[];
  /** Ids of bookmarks created by this import — the enrichment trigger (ARCHITECTURE §8). */
  addedIds: string[];
  /** When the import was staged for vocabulary review instead of committed. */
  staged?: boolean;
  /** `import_batches` id when staged; commit/discard via the review flow. */
  batchId?: string;
  /** Proposed vocabulary awaiting review (present when staged). */
  proposals?: VocabularyProposal[];
}
