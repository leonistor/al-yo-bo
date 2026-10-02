-- URL uniqueness becomes per-dataset (MODEL.md principle 1): the same page may
-- be collected in two workspaces — datasets are the isolation boundary, and
-- the previous global UNIQUE(url) made that structurally impossible, so an
-- import into one dataset could "update" a bookmark living in another.
--
-- Safe by construction: the replaced global UNIQUE(url) already implied
-- UNIQUE(dataset_id, url), so no existing row set can violate the scoped
-- index and the swap cannot fail on real data.

DROP INDEX IF EXISTS bookmarks_url_unique;
CREATE UNIQUE INDEX bookmarks_dataset_url_unique ON bookmarks(dataset_id, url);
