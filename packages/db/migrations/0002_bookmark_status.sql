-- Bookmark scrape lifecycle: after repeated dead-link failures a bookmark is kept
-- but marked `invalid`, hidden from default views and skipped by reconciliation.
-- See docs/MODEL.md for the authoritative description.

ALTER TABLE bookmarks ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid'));
ALTER TABLE bookmarks ADD COLUMN scrape_attempts INTEGER NOT NULL DEFAULT 0;
