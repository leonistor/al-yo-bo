export type TagStatus = 'active' | 'deprecated';

export type BookmarkStatus = 'active' | 'invalid';

export type BookmarkListStatus = BookmarkStatus | 'all';

export type AssignmentSource = 'classifier' | 'user' | 'import';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export type BookmarkSort = 'created_at' | 'updated_at' | 'title';

/**
 * The single user's profile — identity only. The profile is the person
 * (MODEL.md principle 8); the row is a singleton (fixed sentinel id) and never
 * deletable.
 */
export interface Profile {
  id: string;
  name: string | null;
  githubUsername: string | null;
  /** Avatar file name under `<DATA_DIR>/profile/`, when one was uploaded. */
  avatarPath: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A node of the orderable category tree (MODEL.md principle 2). `parentId` is
 * null for roots; siblings are unique by name and ordered by the fractional
 * `sortOrder` key. Depth is unlimited; cycles are prevented in the app layer.
 */
export interface Category {
  id: string;
  parentId: string | null;
  /** App-generated fractional index key, lexicographically ordered among siblings. */
  sortOrder: string;
  name: string;
  description: string | null;
  createdAt: number;
}

/** A category with its children nested — the shape the sidebar and MCP consume. */
export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export interface Tag {
  id: string;
  name: string;
  description: string | null;
  /** Lifecycle: `active` is normal; `deprecated` keeps the row for evidence but excludes it from new assignments. */
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

/** Bookmark count per category (structure-agnostic; the tree is built client-side). */
export interface CategoryAggregate {
  id: string;
  parentId: string | null;
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

/**
 * A bookmark extracted from arbitrary text. `categoryPath` is the tree-native
 * ancestor chain (markdown H2 → level-1, H3 → child); the import pipeline
 * resolves it against the tree and auto-creates any missing categories/tags as
 * active.
 */
export interface ImportedBookmark {
  url: string;
  title: string | null;
  description: string | null;
  /** Ancestor chain from the root, e.g. `["dev", "web", "2024"]`. */
  categoryPath: string[];
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
  /** Ids of bookmarks created by this import — the enrichment trigger (ARCHITECTURE §10). */
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

/**
 * A hydrated bookmark plus resolved vocabulary names, ready for serialization.
 * `categoryPath` is the ancestor chain from the root — the one path grammar
 * shared by every format (ARCHITECTURE §7 export).
 */
export interface ExportBookmarkRow extends BookmarkWithTags {
  categoryPath: string[];
}

/** One produced export artifact, before transport packaging (zip lives at the server edge). */
export interface ExportedFile {
  filename: string;
  contentType: string;
  content: string;
}

/** Coarse domain events emitted by core services (ARCHITECTURE §9). */
export type DomainEvent =
  | { topic: 'bookmarks.changed'; bookmarkIds?: string[] }
  | { topic: 'categories.changed' }
  | { topic: 'tags.changed' }
  | { topic: 'profile.changed' }
  | { topic: 'jobs.changed'; bookmarkId?: string; job?: string }
  | { topic: 'invalidate-all' };
