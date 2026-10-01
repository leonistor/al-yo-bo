import type { Database } from 'bun:sqlite';

import {
  bytesToUuid,
  type Aggregates,
  type CategoryAggregate,
  type TagAggregate,
  type TagStatus,
} from '@al-yo-bo/shared';

import { countBookmarks } from './bookmarks.ts';

interface CategoryCountRow {
  id: Uint8Array;
  name: string;
  count: number;
}

interface TagCountRow {
  id: Uint8Array;
  name: string;
  status: string;
  count: number;
}

export function getAggregates(db: Database): Aggregates {
  const categories = db
    .query<CategoryCountRow, []>(
      `SELECT c.id AS id, c.name AS name, COUNT(b.id) AS count
         FROM categories c
         LEFT JOIN bookmarks b ON b.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name`,
    )
    .all()
    .map<CategoryAggregate>((row) => ({
      id: bytesToUuid(row.id),
      name: row.name,
      count: row.count,
    }));

  const tags = db
    .query<TagCountRow, []>(
      `SELECT t.id AS id, t.name AS name, t.status AS status, COUNT(bt.bookmark_id) AS count
         FROM tags t
         LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
        GROUP BY t.id
        ORDER BY count DESC, t.name ASC`,
    )
    .all()
    .map<TagAggregate>((row) => ({
      id: bytesToUuid(row.id),
      name: row.name,
      status: row.status as TagStatus,
      count: row.count,
    }));

  const invalidCount =
    db
      .query<{ count: number }, []>(
        `SELECT COUNT(*) AS count FROM bookmarks WHERE status = 'invalid'`,
      )
      .get()?.count ?? 0;

  return { total: countBookmarks(db), invalidCount, categories, tags };
}
