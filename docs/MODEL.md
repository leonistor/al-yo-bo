# al-yo-bo — Data Model

1. **Datasets are the runtime scoping boundary.** A dataset owns its bookmarks **and** its complete
   vocabulary (sections, categories, tags). Nothing in the classifier or the importer ever crosses a
   dataset boundary: candidates come from the bookmark's dataset only, and imports resolve names
   against the dataset's vocabulary. This is what makes cross-dataset vocabulary leaks (e.g. a demo
   dataset's tags showing up in a personal dataset) structurally impossible.
2. **Categories are an organizing axis, not a hierarchy.** One `categories` table is shared by two
   independent, optional relations: a bookmark may belong to a category, and a tag may belong to a
   category (its classification scope). A bookmark's category is **never** derived from its tags.
   Categories are flat *within* a section; the two-level structure is `sections → categories`, never
   deeper.
3. **Vocabulary is created in its usable state.** Sections and categories are plain organizing
   records with no lifecycle. Tags carry a two-state lifecycle, `active ⇄ deprecated`, where only
   `active` tags are classifier candidates and can be auto-assigned. The importer **auto-creates**
   any missing category or tag as `active` at commit time; the classifier **never creates
   vocabulary**. Nothing is ever parked in a pending, rejected, or merged state.
4. **Separate evidence from effective state.** Classifier output is stored immutably in
   `classification_runs` / `classification_results`; the tags actually applied to a bookmark live in
   `bookmark_tags`. Re-running classification never destroys prior evidence, and changing assignment
   policy never rewrites history.
5. **Classification never invents vocabulary.** A classifier can only select from existing `tags` in
   the bookmark's dataset. Unmatched output is recorded as evidence only — it is never turned into a
   new tag and never auto-assigned.
6. **Provenance is always recoverable.** Every effective tag assignment points back to the run that
   produced it, and each result keeps the classifier's original label.
7. **One durable store.** Relational data, the full-text index (FTS5), and the durable copy of the
   vector data all live in the same SQLite file. A Qdrant collection holds a *rebuildable serving
   copy* of the embeddings (ARCHITECTURE §6): it is never the only copy of anything and is repaired
   from `bookmark_embeddings` at startup.
8. **The profile is the person; datasets are content workspaces.** One singleton `profile` row holds
   the single user's identity (name, GitHub username, avatar file) and the active-dataset pointer.
   The row is not deletable, identity never changes when switching datasets, and there is no user
   axis (no `users` table, no `user_id` columns) anywhere else. Deleting the active dataset only
   nulls the pointer.

## Entity overview

```
profile ─── datasets                                 (active-dataset pointer; singleton identity)

datasets ──< sections ──< categories ──< bookmarks      (organization)
datasets ──< categories ──< tags                        (classification scope)

bookmarks ──< classification_runs ──< classification_results >── tags
bookmarks ──< classification_runs ──< unknown_classification_labels
bookmarks ──< bookmark_tags        >── tags            (effective assignments)

bookmarks ──< bookmark_fts          (keyword index)
bookmarks ──< bookmark_embeddings   (vector index)
```

## Identifiers

**UUIDv7 values are generated in application code**, not by SQL. `bun:sqlite` (Bun 1.4.x) does not
expose user-defined SQL functions, so `uuid_v7()` / `is_uuid_v7()` cannot be registered on every
connection. Instead:

- `packages/db` generates ids with `Bun.randomUUIDv7('buffer')` (a 16-byte UUIDv7) and supplies them
  on every insert, so no column needs a `DEFAULT`.
- The schema enforces the storage shape with `CHECK (typeof(id) = 'blob' AND length(id) = 16)`
  (and the equivalent for nullable/referencing columns), which is what the old `is_uuid_v7()` check
  was buying us without a SQL function.
- The API and UI see canonical UUID strings; `packages/shared` converts between `Uint8Array` and
  string form.

## Tables

### `datasets`

The runtime scoping boundary: a dataset owns its bookmarks and its complete vocabulary. Created on
first use (seeding, import, or the first bookmark); there is no anonymous data.

```sql
CREATE TABLE datasets (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX datasets_name_unique ON datasets(name);
```

### `profile`

The single user's identity — name, GitHub username, avatar file name — plus the active-dataset
pointer (which dataset the running app scopes to). A **singleton**: migration 0007 inserts one row
with the fixed all-zero sentinel id, the app reads it by id (never by name), and there is no delete
path. `active_dataset_id` is a pointer, not ownership — deleting the dataset nulls it
(`ON DELETE SET NULL`), identity survives. The avatar is a file under `<DATA_DIR>/profile/`
(BLOBs would bloat the single backup file); `avatar_path` holds the file name.

```sql
CREATE TABLE profile (
  id                BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  name              TEXT,
  github_username   TEXT,
  avatar_path       TEXT,
  active_dataset_id BLOB REFERENCES datasets(id) ON DELETE SET NULL
                      CHECK (active_dataset_id IS NULL
                             OR (typeof(active_dataset_id) = 'blob' AND length(active_dataset_id) = 16)),
  created_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO profile (id) VALUES (X'00000000000000000000000000000000');
```

### `sections`

Top level of the two-level organization. Sections group flat categories; a category may also exist
at dataset level without a section. Sections are dataset-scoped and have no lifecycle.

```sql
CREATE TABLE sections (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id    BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                    CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX sections_dataset_name_unique ON sections(dataset_id, name);
CREATE INDEX sections_dataset ON sections(dataset_id);
```

### `categories`

Organizing buckets, e.g. `dev`, `web`, `brands`. Flat by design within a section. Categories have no
lifecycle; they are created `active`.

```sql
CREATE TABLE categories (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id    BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                    CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  section_id    BLOB REFERENCES sections(id) ON DELETE SET NULL
                    CHECK (section_id IS NULL OR (typeof(section_id) = 'blob' AND length(section_id) = 16)),
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX categories_dataset_name_unique ON categories(dataset_id, name);
CREATE INDEX categories_dataset ON categories(dataset_id);
CREATE INDEX categories_section ON categories(section_id);
```

### `bookmarks`

The core record: URL plus scraped and user-provided content.

```sql
CREATE TABLE bookmarks (
  id           BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id   BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                   CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  url          TEXT NOT NULL,
  title        TEXT,
  description  TEXT,
  content      TEXT,                              -- scraped page content as markdown
  metadata     TEXT,                              -- JSON: site name, author, favicon, og:*, image, scrape, import
  category_id  BLOB REFERENCES categories(id) ON DELETE SET NULL
                   CHECK (category_id IS NULL OR (typeof(category_id) = 'blob' AND length(category_id) = 16)),
  content_hash TEXT,                              -- hash of scraped content, for change detection
  scraped_at   INTEGER,
  status       TEXT NOT NULL DEFAULT 'active'     -- effective scrape lifecycle (see below)
                   CHECK (status IN ('active', 'invalid')),
  scrape_attempts INTEGER NOT NULL DEFAULT 0,     -- consecutive dead-link failures (reset on success)
  created_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX bookmarks_url_unique ON bookmarks(url);
CREATE INDEX bookmarks_dataset ON bookmarks(dataset_id);
CREATE INDEX bookmarks_category ON bookmarks(category_id);
```

**Lifecycle:** `active ⇄ invalid`. A bookmark becomes `invalid` only after repeated **dead-link**
failures (HTTP 404/410) reach the configured cap (`SCRAPE_MAX_ATTEMPTS`, §8 of ARCHITECTURE). Invalid
bookmarks are **kept** — default list/search views and startup reconciliation exclude them, so a dead
URL is not retried forever, but a `status` filter and the manual re-scrape action keep them
reviewable. A successful scrape resets `scrape_attempts` and restores `active`; editing the URL does
the same, because failure evidence for the old URL no longer applies. Transient failures (timeouts,
5xx, `html-to-markdown` missing) never invalidate and do not count toward the cap. `status` is
effective state (principle 2), not evidence: the failure detail (`{ at, status, message }`) lives in
`metadata.scrape.lastError`.

### `tags`

Controlled vocabulary, dataset-scoped. A tag may belong to a category (its classification scope) or
stand alone.

```sql
CREATE TABLE tags (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id    BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                    CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  category_id   BLOB REFERENCES categories(id) ON DELETE SET NULL
                    CHECK (category_id IS NULL OR (typeof(category_id) = 'blob' AND length(category_id) = 16)),
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

-- Name is unique within a (dataset, category) scope, and unique per dataset
-- when the tag has no category.
CREATE UNIQUE INDEX tags_scoped_name_unique ON tags(dataset_id, category_id, name) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX tags_global_name_unique ON tags(dataset_id, name) WHERE category_id IS NULL;
CREATE INDEX tags_dataset ON tags(dataset_id);
CREATE INDEX tags_category ON tags(category_id);
```

**Lifecycle:** `active ⇄ deprecated`. Only `active` tags are classifier candidates and may be
auto-assigned by the classifier; `deprecated` retires a tag from classification without deleting its
history. Tags are created `active` — by the user, or automatically by the importer for a category/tag
name it has not seen before.

### `classification_runs`

One row per classifier invocation over a bookmark. Immutable.

```sql
CREATE TABLE classification_runs (
  id                 BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  bookmark_id        BLOB NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE
                          CHECK (typeof(bookmark_id) = 'blob' AND length(bookmark_id) = 16),
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
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  run_id      BLOB NOT NULL REFERENCES classification_runs(id) ON DELETE CASCADE
                   CHECK (typeof(run_id) = 'blob' AND length(run_id) = 16),
  tag_id      BLOB NOT NULL REFERENCES tags(id) ON DELETE CASCADE
                   CHECK (typeof(tag_id) = 'blob' AND length(tag_id) = 16),
  probability REAL NOT NULL,
  rank        INTEGER,
  selected    INTEGER NOT NULL DEFAULT 0,         -- 1 = chosen by the assignment policy
  raw_label   TEXT,                               -- original classifier label, pre-mapping
  UNIQUE (run_id, tag_id)
) STRICT;

CREATE INDEX classification_results_tag ON classification_results(tag_id);
```

### `unknown_classification_labels`

Durable evidence for classifier labels that match no candidate tag. Insert-only
(immutable like all classification evidence); `classification_results` keeps its
NOT NULL `tag_id` FK contract untouched. There is deliberately **no FK to
`tags`** — the label matched nothing — and the raw label is preserved verbatim.
No uniqueness constraint: each occurrence, even a repeated label, is its own
evidence row.

```sql
CREATE TABLE unknown_classification_labels (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  run_id      BLOB NOT NULL REFERENCES classification_runs(id) ON DELETE CASCADE
                   CHECK (typeof(run_id) = 'blob' AND length(run_id) = 16),
  raw_label   TEXT NOT NULL,
  probability REAL NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE INDEX unknown_classification_labels_run ON unknown_classification_labels(run_id);
```

### `bookmark_tags`

The **effective** assignment shown in the UI. Composite uniqueness prevents duplicates.

```sql
CREATE TABLE bookmark_tags (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  bookmark_id BLOB NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE
                   CHECK (typeof(bookmark_id) = 'blob' AND length(bookmark_id) = 16),
  tag_id      BLOB NOT NULL REFERENCES tags(id) ON DELETE CASCADE
                   CHECK (typeof(tag_id) = 'blob' AND length(tag_id) = 16),
  source      TEXT NOT NULL CHECK (source IN ('classifier', 'user', 'import')),
  confidence  REAL,
  run_id      BLOB REFERENCES classification_runs(id) ON DELETE SET NULL  -- evidence, if classifier-sourced
                   CHECK (run_id IS NULL OR (typeof(run_id) = 'blob' AND length(run_id) = 16)),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (bookmark_id, tag_id)
) STRICT;

CREATE INDEX bookmark_tags_tag ON bookmark_tags(tag_id);
```

### Search structures

The keyword index is an **internal** structure: FTS5 virtual tables are not `STRICT` and have no `INTEGER`/UUID primary key. It is queried from server-side search code, never through generated CRUD. Embeddings, by contrast, live in a normal `STRICT` table (below).

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

### Semantic search — Qdrant serving, SQLite durable copy

Vectors are stored as little-endian `Float32` BLOBs in a normal `STRICT` table. This table is the
**durable** copy and the rebuild source for the Qdrant collection (one point per row: point id =
bookmark UUID string, cosine space, payload `{ model, dims, categoryId, tagIds }`, collection
metadata `{ model }`). `packages/search` also loads all rows into one in-memory matrix at startup as
the offline fallback; cosine similarity reduces to a dot product on pre-normalized vectors there.
The dimension is fixed by the embedding model, and all rows must share it
(see [ARCHITECTURE.md](./ARCHITECTURE.md#6-search-subsystem)).

```sql
CREATE TABLE bookmark_embeddings (
  bookmark_id BLOB PRIMARY KEY NOT NULL CHECK (typeof(bookmark_id) = 'blob' AND length(bookmark_id) = 16)
                    REFERENCES bookmarks(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,                        -- embedding model id
  dims        INTEGER NOT NULL,                     -- must equal dimension(model)
  embedding   BLOB NOT NULL,                        -- little-endian Float32 array, length = dims * 4 bytes
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
```

## Invariants & rules

- **Dataset scoping.** Every bookmark, category, tag, and section belongs to exactly one dataset.
  The classifier candidate set, the importer's vocabulary resolution, and the review queues are all
  dataset-scoped. Cross-dataset vocabulary is structurally impossible.
- **Uniqueness.** `bookmarks.url` is unique; tag names are unique per (dataset, category) and per
  dataset when unscoped; category names are unique per dataset; section names are unique per dataset;
  `(bookmark_id, tag_id)` in `bookmark_tags` and `(run_id, tag_id)` in `classification_results` are
  unique via `UNIQUE` constraints (not composite primary keys).
- **Assignment policy.** A classifier result becomes an effective `bookmark_tags` row only when its
  probability clears the configured `auto_assign` threshold _and_ the tag is `active` _and_ the tag
  belongs to the bookmark's dataset. Otherwise it is retained as evidence, and the tag is surfaced
  for review (via `candidate`).
- **No classifier-created vocabulary.** A classifier label that maps to no existing tag in the
  dataset is recorded as evidence only (an `unknown_classification_labels` row linked to the run);
  it never creates a tag and is never auto-assigned. An
  importer category or frontmatter tag that matches no vocabulary entry is auto-created `active`.
- **Active by construction.** Only `active` vocabulary is ever assigned or auto-assigned. There is no
  pending or rejected state to review; retiring a tag is `deprecated`, and deleted vocabulary is
  removed outright.
- **Bookmark scrape lifecycle.** Only repeated **dead-link** failures (404/410) move a bookmark to
  `invalid`; the row is retained, excluded from default views and reconciliation, and restored to
  `active` by a successful scrape or a URL edit. Transient failures never invalidate.
- **Referential integrity** is enforced with foreign keys (`PRAGMA foreign_keys = ON`); deletes cascade
  as shown, or set the referencing column to `NULL` where noted.
- **App-generated identifiers.** UUIDv7 primary keys come from `packages/db`
  (`Bun.randomUUIDv7('buffer')`); the schema enforces `typeof(id) = 'blob' AND length(id) = 16`.
- **Server-set timestamps.** `AFTER INSERT` triggers in the migrations force
  `created_at` / `updated_at` to server time on every insert, and `AFTER UPDATE` triggers bump
  `updated_at` — client-sent values are always overridden (a raw authenticated UPDATE could still
  rewrite `created_at`; the app never sends it — v0.9.0 API-hardening scope).

## Deletion semantics

| Deleted            | Effect                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| profile            | **not deletable** — no delete path exists; deleting the active dataset only nulls `active_dataset_id` |
| dataset            | cascades to its bookmarks (→ classification evidence, tags, embeddings, FTS rows), sections, categories, and tags; the profile's `active_dataset_id` is nulled if it pointed here |
| bookmark           | cascades to `classification_runs` (→ results and unknown labels), `bookmark_tags`, and `bookmark_embeddings`; `bookmark_fts` rows are removed by `AFTER DELETE` triggers (virtual tables cannot be FK targets); the Qdrant point (if any) is deleted best-effort by the API and repaired at the next startup sync |
| tag                | cascades to `bookmark_tags` and `classification_results`; the run/evidence for other tags remains                                                                                                                                                                                                                        |
| category           | `bookmarks.category_id` and `tags.category_id` set to `NULL`                                                                                                                                                                                                                                                             |
| section            | `categories.section_id` set to `NULL` (categories survive at dataset level)                                                                                                                                                                                                                                              |
| classification run | `bookmark_tags.run_id` set to `NULL`; effective assignment remains; `classification_results` and `unknown_classification_labels` cascade-delete with the run                                                                                                                                                             |
