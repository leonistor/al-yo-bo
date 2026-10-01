-- Drop the staging table, the proposal/merge columns, and the
-- `status` lifecycle that auto-creation removed (see ARCHITECTURE §7).
--
-- Important: a startup hook in apps/server (`drainImportBatches`, packages/core)
-- commits every still-staged row in `import_batches` BEFORE this migration
-- runs, so the table drops empty. If the drain fails, individual bookmark rows
-- land with `metadata.unmigrated` recording the source batch id; the operator
-- can replay them manually.
--
-- SQLite cannot drop a column directly, so each vocabulary table is rebuilt
-- (copy -> drop -> rename). Ids are preserved; child tables (bookmarks,
-- bookmark_tags, classification evidence, embeddings) stay valid without a
-- rebuild. The migration runner disables foreign_keys for the duration.

-- 1. Drop the staging table. The drain should have emptied it; this is the
--    safety net (and is idempotent — DROP TABLE IF EXISTS skips the error).
DROP TABLE IF EXISTS import_batches;

-- 2. sections: drop `status` and `merged_into_id`. Every existing row is
--    `active`, so the column drops cleanly with no data migration.
CREATE TABLE sections_new (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id  BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO sections_new (id, dataset_id, name, description, created_at)
  SELECT id, dataset_id, name, description, created_at FROM sections;

DROP TABLE sections;
ALTER TABLE sections_new RENAME TO sections;

CREATE UNIQUE INDEX sections_dataset_name_unique ON sections(dataset_id, name);
CREATE INDEX sections_dataset ON sections(dataset_id);

-- 3. categories: drop `status` and `merged_into_id`. Same posture as sections.
CREATE TABLE categories_new (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id  BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  section_id  BLOB REFERENCES sections(id) ON DELETE SET NULL
                CHECK (section_id IS NULL OR (typeof(section_id) = 'blob' AND length(section_id) = 16)),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO categories_new (id, dataset_id, section_id, name, description, created_at)
  SELECT id, dataset_id, section_id, name, description, created_at FROM categories;

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE UNIQUE INDEX categories_dataset_name_unique ON categories(dataset_id, name);
CREATE INDEX categories_dataset ON categories(dataset_id);
CREATE INDEX categories_section ON categories(section_id);

CREATE TRIGGER categories_force_created AFTER INSERT ON categories BEGIN
  UPDATE categories SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
END;

-- 4. tags: drop `merged_into_id` and the `proposed`/`rejected` statuses.
--    Any `proposed` tag is upgraded to `active` (the importer never creates
--    them anymore; this is the data-migration step for legacy rows).
--    `rejected` tags are dropped — they had no effect at runtime.
--    Active/deprecated rows survive with their ids intact.
CREATE TABLE tags_new (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id  BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  category_id BLOB REFERENCES categories(id) ON DELETE SET NULL
                CHECK (category_id IS NULL OR (typeof(category_id) = 'blob' AND length(category_id) = 16)),
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO tags_new (id, dataset_id, category_id, name, description, status, created_at)
  SELECT id, dataset_id, category_id, name, description,
         CASE WHEN status = 'deprecated' THEN 'deprecated' ELSE 'active' END,
         created_at
    FROM tags
   WHERE status IN ('active', 'deprecated');

DROP TABLE tags;
ALTER TABLE tags_new RENAME TO tags;

CREATE UNIQUE INDEX tags_scoped_name_unique ON tags(dataset_id, category_id, name) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX tags_global_name_unique ON tags(dataset_id, name) WHERE category_id IS NULL;
CREATE INDEX tags_dataset ON tags(dataset_id);
CREATE INDEX tags_category ON tags(category_id);

CREATE TRIGGER tags_force_created AFTER INSERT ON tags BEGIN
  UPDATE tags SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
END;
