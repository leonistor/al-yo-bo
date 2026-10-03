import {
  bytesToUuid,
  type AssignmentSource,
  type Bookmark,
  type BookmarkImage,
  type BookmarkStatus,
  type BookmarkTagView,
  type Category,
  type Dataset,
  type Profile,
  type Section,
  type Tag,
  type TagStatus,
} from '@al-yo-bo/shared';

export interface DatasetRow {
  id: Uint8Array;
  name: string;
  created_at: number;
}

export interface ProfileRow {
  id: Uint8Array;
  name: string | null;
  github_username: string | null;
  avatar_path: string | null;
  active_dataset_id: Uint8Array | null;
  created_at: number;
  updated_at: number;
}

export interface SectionRow {
  id: Uint8Array;
  dataset_id: Uint8Array;
  name: string;
  description: string | null;
  created_at: number;
}

export interface CategoryRow {
  id: Uint8Array;
  dataset_id: Uint8Array;
  section_id: Uint8Array | null;
  name: string;
  description: string | null;
  created_at: number;
}

export interface TagRow {
  id: Uint8Array;
  dataset_id: Uint8Array;
  category_id: Uint8Array | null;
  name: string;
  description: string | null;
  status: string;
  created_at: number;
}

export interface BookmarkRow {
  id: Uint8Array;
  dataset_id: Uint8Array;
  url: string;
  title: string | null;
  description: string | null;
  content: string | null;
  metadata: string | null;
  category_id: Uint8Array | null;
  content_hash: string | null;
  scraped_at: number | null;
  status: string;
  scrape_attempts: number;
  created_at: number;
  updated_at: number;
}

export interface BookmarkTagRow {
  tag_id: Uint8Array;
  name: string;
  source: string;
  confidence: number | null;
}

export function mapDataset(row: DatasetRow): Dataset {
  return {
    id: bytesToUuid(row.id),
    name: row.name,
    createdAt: row.created_at,
  };
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    id: bytesToUuid(row.id),
    name: row.name,
    githubUsername: row.github_username,
    avatarPath: row.avatar_path,
    activeDatasetId: row.active_dataset_id ? bytesToUuid(row.active_dataset_id) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSection(row: SectionRow): Section {
  return {
    id: bytesToUuid(row.id),
    datasetId: bytesToUuid(row.dataset_id),
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function mapCategory(row: CategoryRow): Category {
  return {
    id: bytesToUuid(row.id),
    datasetId: bytesToUuid(row.dataset_id),
    sectionId: row.section_id ? bytesToUuid(row.section_id) : null,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function mapTag(row: TagRow): Tag {
  return {
    id: bytesToUuid(row.id),
    datasetId: bytesToUuid(row.dataset_id),
    categoryId: row.category_id ? bytesToUuid(row.category_id) : null,
    name: row.name,
    description: row.description,
    status: row.status as TagStatus,
    createdAt: row.created_at,
  };
}

export function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Pulls the bookmark image references out of `metadata.image` (set by import
 * and the screenshot job — see ARCHITECTURE §8). Missing or malformed entries
 * fall back to a both-null record so consumers never branch on presence.
 */
export function parseBookmarkImage(metadata: Record<string, unknown> | null): BookmarkImage {
  if (!metadata) {
    return { ogImageUrl: null, screenshotPath: null };
  }
  const raw = metadata['image'];
  if (!raw || typeof raw !== 'object') {
    return { ogImageUrl: null, screenshotPath: null };
  }
  const candidate = raw as Record<string, unknown>;
  return {
    ogImageUrl: typeof candidate['ogImageUrl'] === 'string' ? candidate['ogImageUrl'] : null,
    screenshotPath:
      typeof candidate['screenshotPath'] === 'string' ? candidate['screenshotPath'] : null,
  };
}

export function mapBookmark(row: BookmarkRow): Bookmark {
  return {
    id: bytesToUuid(row.id),
    datasetId: bytesToUuid(row.dataset_id),
    url: row.url,
    title: row.title,
    description: row.description,
    content: row.content,
    metadata: parseMetadata(row.metadata),
    categoryId: row.category_id ? bytesToUuid(row.category_id) : null,
    contentHash: row.content_hash,
    scrapedAt: row.scraped_at,
    status: row.status as BookmarkStatus,
    scrapeAttempts: row.scrape_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapBookmarkTag(row: BookmarkTagRow): BookmarkTagView {
  return {
    tagId: bytesToUuid(row.tag_id),
    name: row.name,
    source: row.source as AssignmentSource,
    confidence: row.confidence,
  };
}
