# al-yo-bo — Data Model

1. **Categories are an organizing axis, not a hierarchy.** One `categories` table is shared by two
   independent, optional relations: a bookmark may belong to a category, and a tag may belong to a
   category (its classification scope). A bookmark's category is **never** derived from its tags.
2. **Separate evidence from effective state.** Classifier output is stored immutably in
   `classification_runs` / `classification_results`; the tags actually applied to a bookmark live in
   `bookmark_tags`. Re-running classification never destroys prior evidence, and changing assignment
   policy never rewrites history.
3. **Classification never invents vocabulary.** A classifier can only select from existing `tags`.
   Unmatched output is recorded as a `proposed` tag that requires explicit user approval before use.
4. **Provenance is always recoverable.** Every effective tag assignment points back to the run that
   produced it, and each result keeps the classifier's original label.
5. **One store.** Relational data, full-text search (FTS5), and vector search (sqlite-vec) all live in
   the same SQLite file.

## Entity overview

```
categories ──< bookmarks            (optional: bookmark organization)
categories ──< tags                 (optional: classification scope)

bookmarks ──< classification_runs ──< classification_results >── tags
bookmarks ──< bookmark_tags        >── tags            (effective assignments)

bookmarks ──< bookmark_fts          (keyword index)
bookmarks ──< bookmark_embeddings   (vector index)
```

## Tables

### `categories`

Organizing buckets, e.g. `dev`, `web`, `brands`. Flat by design.

```sql
CREATE TABLE categories (
  id          BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX categories_name_unique ON categories(name);
```

### `bookmarks`

The core record: URL plus scraped and user-provided content.

```sql
CREATE TABLE bookmarks (
  id           BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  url          TEXT NOT NULL,
  title        TEXT,
  description  TEXT,
  content      TEXT,                              -- scraped page content as markdown
  metadata     TEXT,                              -- JSON: site name, author, favicon, og:*, ...
  category_id  BLOB REFERENCES categories(id) ON DELETE SET NULL
                    CHECK (category_id IS NULL OR is_uuid_v7(category_id)),
  content_hash TEXT,                              -- hash of scraped content, for change detection
  scraped_at   INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX bookmarks_url_unique ON bookmarks(url);
CREATE INDEX bookmarks_category ON bookmarks(category_id);
```

### `tags`

Controlled vocabulary. A tag may belong to a category (its classification scope) or stand alone.

```sql
CREATE TABLE tags (
  id          BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  category_id BLOB REFERENCES categories(id) ON DELETE SET NULL
                   CHECK (category_id IS NULL OR is_uuid_v7(category_id)),
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL CHECK (status IN ('active', 'proposed', 'deprecated')),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

-- Name is unique within a category, and unique globally when the tag has no category.
CREATE UNIQUE INDEX tags_scoped_name_unique ON tags(category_id, name) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX tags_global_name_unique ON tags(name)                   WHERE category_id IS NULL;
CREATE INDEX tags_category ON tags(category_id);
```

**Lifecycle:** `proposed` → (user approval) → `active` → `deprecated`. Only `active` tags may be
auto-assigned by the classifier.

### `classification_runs`

One row per classifier invocation over a bookmark. Immutable.

```sql
CREATE TABLE classification_runs (
  id                 BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  bookmark_id        BLOB NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE
                          CHECK (is_uuid_v7(bookmark_id)),
  classifier         TEXT NOT NULL,               -- e.g. "ollaya"
  classifier_version TEXT,                        -- runtime version
  model              TEXT,                        -- decision model id, e.g. "laya"
  confidence         REAL,                        -- run-level confidence, optional
  created_at         INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE INDEX classification_runs_bookmark ON classification_runs(bookmark_id, created_at);
```

### `classification_results`

Per-tag output of a run. Immutable. Keeps the classifier's raw label even if the mapped tag changes.

```sql
CREATE TABLE classification_results (
  id          BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  run_id      BLOB NOT NULL REFERENCES classification_runs(id) ON DELETE CASCADE
                   CHECK (is_uuid_v7(run_id)),
  tag_id      BLOB NOT NULL REFERENCES tags(id) ON DELETE CASCADE
                   CHECK (is_uuid_v7(tag_id)),
  probability REAL NOT NULL,
  rank        INTEGER,
  selected    INTEGER NOT NULL DEFAULT 0,         -- 1 = chosen by the assignment policy
  raw_label   TEXT,                               -- original classifier label, pre-mapping
  UNIQUE (run_id, tag_id)
) STRICT;

CREATE INDEX classification_results_tag ON classification_results(tag_id);
```

> The former composite `PRIMARY KEY (run_id, tag_id)` becomes a surrogate `id` PK plus a `UNIQUE`
> constraint — TrailBase cannot expose composite keys, and uniqueness is fully preserved by `UNIQUE`.

### `bookmark_tags`

The **effective** assignment shown in the UI. Composite uniqueness prevents duplicates.

```sql
CREATE TABLE bookmark_tags (
  id          BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  bookmark_id BLOB NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE
                   CHECK (is_uuid_v7(bookmark_id)),
  tag_id      BLOB NOT NULL REFERENCES tags(id) ON DELETE CASCADE
                   CHECK (is_uuid_v7(tag_id)),
  source      TEXT NOT NULL CHECK (source IN ('classifier', 'user', 'import')),
  confidence  REAL,
  run_id      BLOB REFERENCES classification_runs(id) ON DELETE SET NULL  -- evidence, if classifier-sourced
                   CHECK (run_id IS NULL OR is_uuid_v7(run_id)),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (bookmark_id, tag_id)
) STRICT;

CREATE INDEX bookmark_tags_tag ON bookmark_tags(tag_id);
```

### Search structures

These are **internal** structures: FTS5 and `vec0` virtual tables are not `STRICT` and have no
`INTEGER`/UUID primary key, so TrailBase **cannot expose them as record APIs**. They are queried from
server-side search code, never through generated CRUD.

### Keyword search — FTS5

```sql
CREATE VIRTUAL TABLE bookmark_fts USING fts5(
  bookmark_id UNINDEXED,                             -- BLOB UUIDv7 (FTS5 stores blobs in UNINDEXED columns)
  url,
  title,
  description,
  content,
  tokenize = 'unicode61'
);
```

`bookmark_id` stores the **BLOB** UUID, so `bookmarks.id = bookmark_fts.bookmark_id` joins directly in
any SQLite connection (no extension needed). Kept in sync with `bookmarks` by triggers.

### Semantic search — sqlite-vec

```sql
CREATE VIRTUAL TABLE bookmark_embeddings USING vec0(
  bookmark_id TEXT PRIMARY KEY,                     -- canonical UUID text (vec0 PKs are INTEGER/TEXT only)
  embedding    FLOAT[1536]                          -- dimension set by the embedding model
);
```

`vec0` primary keys cannot be `BLOB`, so `bookmark_id` holds the **canonical UUID text**. Joining back
to `bookmarks` uses `uuid_parse(bookmark_embeddings.bookmark_id)` in a TrailBase connection, or a
client-side conversion; the shared codec owns that conversion.

Hybrid ranking combines FTS5 (BM25) and sqlite-vec (KNN) results, e.g. with reciprocal rank fusion.

## Invariants & rules

- **Uniqueness.** `bookmarks.url` is unique; tag names are unique per category (and globally for
  uncategorized tags); `(bookmark_id, tag_id)` in `bookmark_tags` and `(run_id, tag_id)` in
  `classification_results` are unique via `UNIQUE` constraints (not composite primary keys).
- **Assignment policy.** A classifier result becomes an effective `bookmark_tags` row only when its
  probability clears the configured `auto_assign` threshold _and_ the tag is `active`. Otherwise it is
  retained as evidence, and the tag is surfaced for review (via `candidate`).
- **No auto-creation.** A classifier label that maps to no existing tag creates a `proposed` tag, which
  is never auto-assigned.
- **Referential integrity** is enforced with foreign keys (`PRAGMA foreign_keys = ON`); deletes cascade
  as shown, or set the referencing column to `NULL` where noted.
- **Server-set timestamps.** `AFTER INSERT` triggers (`U1790533231__server_timestamps.sql`) force
  `created_at` / `updated_at` to server time on every insert, and `AFTER UPDATE` triggers bump
  `updated_at` — client-sent values are always overridden (a raw authenticated UPDATE could still
  rewrite `created_at`; the app never sends it — v0.9.0 API-hardening scope).

## Deletion semantics

| Deleted            | Effect                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bookmark           | cascades to `classification_runs` (→ results), `bookmark_tags`; `bookmark_fts` / `bookmark_embeddings` rows are removed by `AFTER DELETE` triggers (virtual tables cannot be FK targets) |
| tag                | cascades to `bookmark_tags` and `classification_results`; the run/evidence for other tags remains                                                                                        |
| category           | `bookmarks.category_id` and `tags.category_id` set to `NULL`                                                                                                                             |
| classification run | `bookmark_tags.run_id` set to `NULL`; effective assignment remains                                                                                                                       |
