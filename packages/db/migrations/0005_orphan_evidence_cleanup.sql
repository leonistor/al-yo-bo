-- Repair for 0004_simplify_vocabulary: that migration dropped `rejected` tags
-- (copying only active/deprecated rows into tags_new) while foreign keys were
-- disabled, leaving classification_results / bookmark_tags rows pointing at
-- tag ids that no longer exist. Since 0004 is already applied to existing dev
-- databases, the cleanup ships here instead of editing 0004.
--
-- Idempotent: the NOT IN deletes are no-ops on databases with no orphans
-- (including fresh databases where 0001-0005 apply in sequence).

DELETE FROM classification_results
 WHERE tag_id NOT IN (SELECT id FROM tags);

DELETE FROM bookmark_tags
 WHERE tag_id NOT IN (SELECT id FROM tags);