import type { Database } from 'bun:sqlite';

import {
  bytesToUuid,
  uuidToBytes,
  type Aggregates,
  type CategoryAggregate,
  type SectionAggregate,
  type TagAggregate,
  type TagStatus,
} from '@al-yo-bo/shared';

import { countBookmarks } from './bookmarks.ts';
import { prepared } from './statements.ts';

interface SectionCountRow {
  id: Uint8Array;
  name: string;
  count: number;
}

interface CategoryCountRow {
  id: Uint8Array;
  name: string;
  section_id: Uint8Array | null;
  count: number;
}

interface TagCountRow {
  id: Uint8Array;
  name: string;
  status: string;
  count: number;
}

export function getAggregates(db: Database, datasetId: string): Aggregates {
  const sections = prepared<SectionCountRow, [Uint8Array]>(
    db,
    `SELECT s.id AS id, s.name AS name, COUNT(b.id) AS count
         FROM sections s
         LEFT JOIN categories c ON c.section_id = s.id
         LEFT JOIN bookmarks b ON b.category_id = c.id
        WHERE s.dataset_id = ?
        GROUP BY s.id
        ORDER BY s.name`,
  )
    .all(uuidToBytes(datasetId))
    .map<SectionAggregate>((row) => ({
      id: bytesToUuid(row.id),
      name: row.name,
      count: row.count,
    }));

  const categories = prepared<CategoryCountRow, [Uint8Array]>(
    db,
    `SELECT c.id AS id, c.name AS name, c.section_id AS section_id, COUNT(b.id) AS count
         FROM categories c
         LEFT JOIN bookmarks b ON b.category_id = c.id
        WHERE c.dataset_id = ?
        GROUP BY c.id
        ORDER BY c.name`,
  )
    .all(uuidToBytes(datasetId))
    .map<CategoryAggregate>((row) => ({
      id: bytesToUuid(row.id),
      name: row.name,
      sectionId: row.section_id ? bytesToUuid(row.section_id) : null,
      count: row.count,
    }));

  const tags = prepared<TagCountRow, [Uint8Array]>(
    db,
    `SELECT t.id AS id, t.name AS name, t.status AS status, COUNT(bt.bookmark_id) AS count
         FROM tags t
         LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
        WHERE t.dataset_id = ?
        GROUP BY t.id
        ORDER BY count DESC, t.name ASC`,
  )
    .all(uuidToBytes(datasetId))
    .map<TagAggregate>((row) => ({
      id: bytesToUuid(row.id),
      name: row.name,
      status: row.status as TagStatus,
      count: row.count,
    }));

  const invalidCount =
    prepared<{ count: number }, [Uint8Array]>(
      db,
      `SELECT COUNT(*) AS count FROM bookmarks WHERE dataset_id = ? AND status = 'invalid'`,
    ).get(uuidToBytes(datasetId))?.count ?? 0;

  return {
    total: countBookmarks(db, datasetId),
    invalidCount,
    sections,
    categories,
    tags,
  };
}
