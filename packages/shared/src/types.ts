export type TagStatus = 'active' | 'deprecated';

export type BookmarkStatus = 'active' | 'invalid';

export type BookmarkListStatus = BookmarkStatus | 'all';

export type AssignmentSource = 'classifier' | 'user' | 'import';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export type BookmarkSort = 'created_at' | 'updated_at' | 'title';

export interface Dataset {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * The single user's profile — identity plus the active-dataset pointer. The
 * profile is the person; datasets are content workspaces (MODEL.md). The row
 * is a singleton (fixed sentinel id) and never deletable.
 */
export interface Profile {
  id: string;
  name: string | null;
  githubUsername: string | null;
  /** Avatar file name under `<DATA_DIR>/profile/`, when one was uploaded. */
  avatarPath: string | null;
  /** Dataset the running app scopes to; null falls back to `DEFAULT_DATASET`. */
  activeDatasetId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Section {
  id: string;
  datasetId: string;
  name: string;
  description: string | null;
  createdAt: number;
}

export interface Category {
  id: string;
  datasetId: string;
  sectionId: string | null;
  name: string;
  description: string | null;
  createdAt: number;
}

export interface Tag {
  id: string;
  datasetId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  /** Lifecycle: `active` is normal; `deprecated` keeps the row for evidence but excludes it from new assignments. */
  status: TagStatus;
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

/** Visual references parsed from `bookmarks.metadata.image`. */
export interface BookmarkImage {
  /** og:image URL discovered at scrape/import time (may be a remote URL). */
  ogImageUrl: string | null;
  /** Local path under `data/screenshots/`, relative to the server root. */
  screenshotPath: string | null;
}

export interface BookmarkWithTags extends Bookmark {
  tags: BookmarkTagView[];
  image?: BookmarkImage;
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

/**
 * A bookmark extracted from arbitrary text. `category` is the most specific
 * category name available; the import pipeline auto-creates any missing
 * vocabulary as active. (Phase 0 simplification: there is no separate
 * `subsection` field — the markdown parser flattens H2/H3 into one category.)
 */
export interface ImportedBookmark {
  url: string;
  title: string | null;
  description: string | null;
  category: string | null;
  priority: number | null;
  /** Tag names declared in the source (frontmatter, etc.). */
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

/** File formats the Export feature can produce. */
export type ExportFormat = 'html' | 'json' | 'csv' | 'markdown';

/**
 * Bookmark selection for an export run — mirrors the search filter fields.
 * Dates are epoch-ms bounds on `created_at` (inclusive), like `SearchQuery`.
 */
export interface ExportFilters {
  q?: string;
  categoryId?: string;
  tagId?: string;
  status?: BookmarkListStatus;
  dateFrom?: number;
  dateTo?: number;
}

/** A hydrated bookmark plus resolved vocabulary names, ready for serialization. */
export interface ExportBookmarkRow extends BookmarkWithTags {
  categoryName: string | null;
  sectionName: string | null;
}

/** One produced export artifact, before transport packaging (zip lives at the server edge). */
export interface ExportedFile {
  filename: string;
  contentType: string;
  content: string;
}
