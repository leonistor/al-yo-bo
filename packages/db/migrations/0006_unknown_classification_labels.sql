-- Durable evidence for classifier labels that match no candidate tag
-- (ARCHITECTURE §7 / MODEL.md: unknown labels are recorded as evidence only).
--
-- `classification_results` keeps its NOT NULL `tag_id` FK contract untouched;
-- unknown labels get their own insert-only table instead. There is no FK to
-- `tags` (the label matched nothing) and no uniqueness constraint: every
-- occurrence is kept, with the raw label verbatim. Rows are immutable — no
-- update path exists — and cascade-delete with their run.

CREATE TABLE unknown_classification_labels (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  run_id      BLOB NOT NULL REFERENCES classification_runs(id) ON DELETE CASCADE
                   CHECK (typeof(run_id) = 'blob' AND length(run_id) = 16),
  raw_label   TEXT NOT NULL,
  probability REAL NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE INDEX unknown_classification_labels_run ON unknown_classification_labels(run_id);

CREATE TRIGGER unknown_classification_labels_force_created AFTER INSERT ON unknown_classification_labels BEGIN
  UPDATE unknown_classification_labels SET created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
END;