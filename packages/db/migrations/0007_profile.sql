-- Single-user profile: identity (name, GitHub username, avatar) plus the
-- active-dataset pointer. The profile is the person; datasets are content
-- workspaces (MODEL.md) — orthogonal tables, no user axis anywhere else.
--
-- Singleton by design: one fixed sentinel row, created here and looked up by
-- id, never by name. The all-zero BLOB id follows the repo-wide uuidv7 CHECK
-- format (the `datasets` 'default' sentinel is the precedent). The row is not
-- deletable: there is no delete path, and deleting a dataset only nulls the
-- active pointer (ON DELETE SET NULL) — identity never cascades away.

CREATE TABLE profile (
  id                BLOB PRIMARY KEY NOT NULL
                      CHECK (typeof(id) = 'blob' AND length(id) = 16),
  name              TEXT,
  github_username   TEXT,
  avatar_path       TEXT,
  active_dataset_id BLOB REFERENCES datasets(id) ON DELETE SET NULL
                      CHECK (active_dataset_id IS NULL
                             OR (typeof(active_dataset_id) = 'blob'
                                 AND length(active_dataset_id) = 16)),
  created_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

-- Fixed sentinel id (all-zero): the app reads the profile by id, never by name.
INSERT INTO profile (id) VALUES (X'00000000000000000000000000000000');

CREATE TRIGGER profile_touch_updated_at AFTER UPDATE ON profile BEGIN
  UPDATE profile SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
END;
