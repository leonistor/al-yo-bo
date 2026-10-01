import {
  bytesToUuid,
  type AssignmentSource,
  type Bookmark,
  type BookmarkStatus,
  type BookmarkTagView,
  type Category,
  type Tag,
  type TagStatus,
} from '@al-yo-bo/shared';

export interface CategoryRow {
  id: Uint8Array;
  name: string;
  description: string | null;
  created_at: number;
}

export interface TagRow {
  id: Uint8Array;
  category_id: Uint8Array | null;
  name: string;
  description: string | null;
  status: string;
  created_at: number;
}

export interface BookmarkRow {
  id: Uint8Array;
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

export function mapCategory(row: CategoryRow): Category {
  return {
    id: bytesToUuid(row.id),
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function mapTag(row: TagRow): Tag {
  return {
    id: bytesToUuid(row.id),
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

export function mapBookmark(row: BookmarkRow): Bookmark {
  return {
    id: bytesToUuid(row.id),
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
