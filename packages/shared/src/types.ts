export type TagStatus = 'active' | 'proposed' | 'deprecated';

export type BookmarkStatus = 'active' | 'invalid';

export type BookmarkListStatus = BookmarkStatus | 'all';

export type AssignmentSource = 'classifier' | 'user' | 'import';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export type BookmarkSort = 'created_at' | 'updated_at' | 'title';

export interface Category {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
}

export interface Tag {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  status: TagStatus;
  createdAt: number;
}

export interface Bookmark {
  id: string;
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
}
