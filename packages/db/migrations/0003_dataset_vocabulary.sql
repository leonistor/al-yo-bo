-- Dataset-scoped vocabulary, two-level categories, and staged imports.
-- See docs/MODEL.md for the authoritative description.
--
-- SQLite cannot add NOT NULL FK columns or change CHECK constraints via ALTER
-- TABLE, so categories/tags/bookmarks are rebuilt (copy -> drop -> rename). The
-- migration runner disables foreign_keys for the duration of each file; every
-- id is preserved, so child tables (classification evidence, bookmark_tags,
-- bookmark_embeddings, bookmark_fts) stay valid without a rebuild.

-- 1. datasets + the default dataset existing rows are backfilled into.
CREATE TABLE datasets (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX datasets_name_unique ON datasets(name);

-- Fixed sentinel id: the app looks the default dataset up by name, never by id.
INSERT INTO datasets (id, name) VALUES (X'00000000000000000000000000000001', 'default');

-- 2. sections (two-level organization: sections -> flat categories).
CREATE TABLE sections (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id    BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                    CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'proposed', 'rejected')),
  merged_into_id BLOB REFERENCES sections(id) ON DELETE SET NULL
                    CHECK (merged_into_id IS NULL OR (typeof(merged_into_id) = 'blob' AND length(merged_into_id) = 16)),
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX sections_dataset_name_unique ON sections(dataset_id, name);
CREATE INDEX sections_dataset ON sections(dataset_id);

-- 3. import_batches (staged imports awaiting vocabulary review).
CREATE TABLE import_batches (
  id           BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id   BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                   CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  file         TEXT,
  bookmarks    TEXT NOT NULL,                    -- JSON: ImportedBookmark[]
  status       TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'committed', 'discarded')),
  created_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  committed_at INTEGER
) STRICT;

CREATE INDEX import_batches_dataset ON import_batches(dataset_id, status);

-- 4. rebuild categories: dataset scope, optional section, lifecycle status,
--    and merge resolution. The self-FK references the FINAL name (`categories`):
--    ALTER TABLE RENAME does not rewrite self-references, and referencing the
--    final name resolves to the renamed table once the old one is dropped.
CREATE TABLE categories_new (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id    BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                    CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  section_id    BLOB REFERENCES sections(id) ON DELETE SET NULL
                    CHECK (section_id IS NULL OR (typeof(section_id) = 'blob' AND length(section_id) = 16)),
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'proposed', 'rejected')),
  merged_into_id BLOB REFERENCES categories(id) ON DELETE SET NULL
                    CHECK (merged_into_id IS NULL OR (typeof(merged_into_id) = 'blob' AND length(merged_into_id) = 16)),
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO categories_new (id, dataset_id, section_id, name, description, status, merged_into_id, created_at)
  SELECT id, X'00000000000000000000000000000001', NULL, name, description, 'active', NULL, created_at
    FROM categories;

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE UNIQUE INDEX categories_dataset_name_unique ON categories(dataset_id, name);
CREATE INDEX categories_dataset ON categories(dataset_id);
CREATE INDEX categories_section ON categories(section_id);

CREATE TRIGGER categories_force_created AFTER INSERT ON categories BEGIN
  UPDATE categories SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
END;

-- 5. rebuild tags: dataset scope, 'rejected' status, merge resolution. The
--    self-FK references the final name (`tags`), same reason as categories.
CREATE TABLE tags_new (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id    BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                    CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  category_id   BLOB REFERENCES categories(id) ON DELETE SET NULL
                    CHECK (category_id IS NULL OR (typeof(category_id) = 'blob' AND length(category_id) = 16)),
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active', 'proposed', 'deprecated', 'rejected')),
  merged_into_id BLOB REFERENCES tags(id) ON DELETE SET NULL
                    CHECK (merged_into_id IS NULL OR (typeof(merged_into_id) = 'blob' AND length(merged_into_id) = 16)),
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO tags_new (id, dataset_id, category_id, name, description, status, merged_into_id, created_at)
  SELECT id, X'00000000000000000000000000000001', category_id, name, description, status, NULL, created_at
    FROM tags;

DROP TABLE tags;
ALTER TABLE tags_new RENAME TO tags;

CREATE UNIQUE INDEX tags_scoped_name_unique ON tags(dataset_id, category_id, name) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX tags_global_name_unique ON tags(dataset_id, name) WHERE category_id IS NULL;
CREATE INDEX tags_dataset ON tags(dataset_id);
CREATE INDEX tags_category ON tags(category_id);

CREATE TRIGGER tags_force_created AFTER INSERT ON tags BEGIN
  UPDATE tags SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
END;

-- 6. rebuild bookmarks: dataset scope. Ids are preserved, so classification
--    evidence, bookmark_tags, embeddings, and FTS rows stay valid.
CREATE TABLE bookmarks_new (
  id           BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id   BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                   CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  url          TEXT NOT NULL,
  title        TEXT,
  description  TEXT,
  content      TEXT,
  metadata     TEXT,
  category_id  BLOB REFERENCES categories(id) ON DELETE SET NULL
                   CHECK (category_id IS NULL OR (typeof(category_id) = 'blob' AND length(category_id) = 16)),
  content_hash TEXT,
  scraped_at   INTEGER,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid')),
  scrape_attempts INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO bookmarks_new (id, dataset_id, url, title, description, content, metadata, category_id, content_hash, scraped_at, status, scrape_attempts, created_at, updated_at)
  SELECT id, X'00000000000000000000000000000001', url, title, description, content, metadata, category_id, content_hash, scraped_at, status, scrape_attempts, created_at, updated_at
    FROM bookmarks;

DROP TABLE bookmarks;
ALTER TABLE bookmarks_new RENAME TO bookmarks;

CREATE UNIQUE INDEX bookmarks_url_unique ON bookmarks(url);
CREATE INDEX bookmarks_dataset ON bookmarks(dataset_id);
CREATE INDEX bookmarks_category ON bookmarks(category_id);

CREATE TRIGGER bookmarks_force_created AFTER INSERT ON bookmarks BEGIN
  UPDATE bookmarks
     SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
         updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
   WHERE id = NEW.id;
END;

CREATE TRIGGER bookmarks_bump_updated AFTER UPDATE ON bookmarks BEGIN
  UPDATE bookmarks SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
END;

CREATE TRIGGER bookmarks_fts_insert AFTER INSERT ON bookmarks BEGIN
  INSERT INTO bookmark_fts (bookmark_id, url, title, description, content)
  VALUES (NEW.id, NEW.url, NEW.title, NEW.description, NEW.content);
END;

CREATE TRIGGER bookmarks_fts_update AFTER UPDATE ON bookmarks BEGIN
  DELETE FROM bookmark_fts WHERE bookmark_id = OLD.id;
  INSERT INTO bookmark_fts (bookmark_id, url, title, description, content)
  VALUES (NEW.id, NEW.url, NEW.title, NEW.description, NEW.content);
END;

CREATE TRIGGER bookmarks_fts_delete AFTER DELETE ON bookmarks BEGIN
  DELETE FROM bookmark_fts WHERE bookmark_id = OLD.id;
END;