# al-yo-bo — Data Model

> v2, rewritten 2026-10-04 for the full rewrite (see `docs/plans/rewrite-v2.md`). The database is
> born at migration `0001` in this shape; there is no legacy-data migration. The pre-rewrite model
> (datasets, sections, scoped tags) is preserved at the `legacy` git tag.

1. **One workspace — no scoping axis.** Every bookmark, category, and tag belongs to the single
   library. There are no datasets. What dataset scoping used to prevent (a demo dataset's
   vocabulary leaking into a personal one) is moot with exactly one workspace: development
   isolation is a scratch `DATA_DIR`, not a schema concept. There is no user axis either.
2. **Categories are an orderable tree.** `categories.parent_id → categories(id)` defines an
   unlimited-depth tree; cycles are impossible to express in SQL with a self-FK, so the app layer
   validates every parent assignment and subtree move. Sibling names are unique — `(parent_id,
   name)` via two partial unique indexes (the NULL-parent case gets its own) — so `web/2024` and
   `books/2024` may coexist. `sort_order` is an app-generated **fractional index** string: new
   siblings get a key between their neighbors, drag-reorder computes the midpoint, and an exhausted
   gap triggers a rebalance of that sibling list. A bookmark belongs to at most one category (a
   leaf or any interior node). **Tags have no category** — the classifier candidate set is all
   `active` tags.
3. **Vocabulary is created in its usable state.** Categories are plain organizing records with no
   lifecycle. Tags carry a two-state lifecycle, `active ⇄ deprecated`, where only `active` tags are
   classifier candidates and can be auto-assigned. Vocabulary is created `active` by explicit user
   action: the setup wizard (on confirmation), the importer (at commit time), or the manual
   vocabulary UI. The classifier **never creates vocabulary**. Nothing is ever parked in a pending,
   rejected, or merged state.
4. **Separate evidence from effective state — immutability without exception.** Classifier output
   is stored immutably in `classification_runs`; the tags actually applied to a bookmark live in
   `bookmark_tags`. Re-running classification never destroys prior evidence. No code path —
   including seeds, CLI scripts, and future migrations — may UPDATE an evidence row.
5. **Vocabulary is created only by explicit user action.** A classifier can only select from
   existing `active` tags; it never creates, promotes, or auto-assigns vocabulary. Unmatched
   classifier labels are logged and discarded. Vocabulary is created by manual UI edits, import
   commit, or setup-wizard confirmation.
6. **Provenance is always recoverable.** Every effective tag assignment records its `source`
   (`'classifier'`, `'user'`, or `'import'`), `confidence`, and (for classifier-sourced rows) the
   `classification_runs.id` it came from.
7. **One durable store.** Relational data, the full-text index (FTS5), and the durable copy of the
   vector data all live in the same SQLite file. A Qdrant collection holds a *rebuildable serving
   copy* of the embeddings (ARCHITECTURE §6): it is never the only copy of anything and is repaired
   from `bookmark_embeddings` at startup.
8. **The profile is the person and their setup state.** One singleton `profile` row holds the
   single user's identity (name, GitHub username, avatar file) plus a `dev_profile` JSON
   questionnaire and a `setup_completed_at` timestamp. The row is not deletable, has no dataset
   pointer, and there is no `users` table or `user_id` column anywhere.

## Entity overview

```
profile                                    (singleton identity + setup state)

categories ──< categories                  (self-referencing tree)
categories ──< bookmarks                   (organization)

bookmarks ──< classification_runs          (provenance anchor)
bookmarks ──< bookmark_tags        >── tags            (effective assignments)

bookmarks ──< bookmark_fts          (keyword index)
bookmarks ──< bookmark_embeddings   (vector index)
```

## Identifiers

**UUIDv7 values are generated in application code**, not by SQL. `bun:sqlite` (Bun 1.4.x) does not
expose user-defined SQL functions, so `uuid_v7()` / `is_uuid_v7()` cannot be registered on every
connection. Instead:

- `packages/db` generates ids with `Bun.randomUUIDv7('buffer')` (a 16-byte UUIDv7) and supplies
  them on every insert, so no column needs a `DEFAULT`.
- The schema enforces the storage shape with `CHECK (typeof(id) = 'blob' AND length(id) = 16)`
  (and the equivalent for nullable/referencing columns).
- The API and UI see canonical UUID strings; `packages/shared` converts between `Uint8Array` and
  string form.

## Tables

### `profile`

The single user's identity and setup state. A **singleton**: migration
`0001` inserts one row with the fixed all-zero sentinel id, the app reads it by id (never by
name), and there is no delete path. The avatar is a file under `<DATA_DIR>/profile/` (BLOBs would
bloat the single backup file); `avatar_path` holds the file name. `dev_profile` stores the
developer-questionnaire responses (source, focus, languages, frameworks, tools, experience, and
optional notes) as JSON. `setup_completed_at` is an epoch-millisecond timestamp: `NULL` means the
setup wizard is still pending; seeding and the wizard's final step set it.

```sql
CREATE TABLE profile (
  id                BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  name              TEXT,
  github_username   TEXT,
  avatar_path       TEXT,
  dev_profile       TEXT,                         -- JSON: source, focus, languages, frameworks, tools, experience, notes?
  setup_completed_at INTEGER,                     -- epoch ms; NULL = wizard pending
  created_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO profile (id) VALUES (X'00000000000000000000000000000000');
```

### `categories`

Orderable tree of organizing buckets, e.g. `dev ▸ web ▸ 2024`. Depth is unlimited; the app
validates parent assignment and subtree moves against cycles (a category can never take one of its
own descendants as parent). No lifecycle; created `active` (i.e. plain records) by the user or the
importer.

`sort_order` is the fractional index key (see principle 2): app-generated, lexicographically
ordered under `BINARY` collation, unique only in practice (the schema does not enforce it — gaps
are the point).

```sql
CREATE TABLE categories (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  parent_id     BLOB REFERENCES categories(id) ON DELETE CASCADE
                    CHECK (parent_id IS NULL OR (typeof(parent_id) = 'blob' AND length(parent_id) = 16)),
  sort_order    TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

-- Sibling names are unique; the NULL-parent case needs its own partial index.
CREATE UNIQUE INDEX categories_root_name_unique ON categories(name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX categories_child_name_unique ON categories(parent_id, name) WHERE parent_id IS NOT NULL;
CREATE INDEX categories_parent_order ON categories(parent_id, sort_order);
```

**Deletion:** deleting a category deletes its **subtree** (children cascade via the self-FK).
Bookmarks are content, not structure: every orphaned `bookmarks.category_id` in the subtree is set
to `NULL` (`ON DELETE SET NULL`) — bookmarks survive. The UI confirms with the subtree's category
and bookmark counts before deleting.

### `bookmarks`

The core record: URL plus scraped and user-provided content. URL uniqueness is **global** — one
workspace means one row per URL.

```sql
CREATE TABLE bookmarks (
  id           BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
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
CREATE INDEX bookmarks_category ON bookmarks(category_id);
```

**Lifecycle:** `active ⇄ invalid`. A bookmark becomes `invalid` only after repeated **dead-link**
failures (HTTP 404/410) reach the configured cap (`SCRAPE_MAX_ATTEMPTS`, §10 of ARCHITECTURE).
Invalid bookmarks are **kept** — default list/search views and startup reconciliation exclude
them, so a dead URL is not retried forever, but a `status` filter and the manual re-scrape action
keep them reviewable. A successful scrape resets `scrape_attempts` and restores `active`; editing
the URL does the same, because failure evidence for the old URL no longer applies. Transient
failures (timeouts, 5xx, `html-to-markdown` missing) never invalidate and do not count toward the
cap. `status` is effective state (principle 4), not evidence: the failure detail
(`{ at, status, message }`) lives in `metadata.scrape.lastError`.

### `tags`

Controlled vocabulary. One flat, global namespace — a tag is a tag regardless of which category a
bookmark sits in.

```sql
CREATE TABLE tags (
  id            BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE UNIQUE INDEX tags_name_unique ON tags(name);
```

**Lifecycle:** `active ⇄ deprecated`. Only `active` tags are classifier candidates and may be
auto-assigned by the classifier; `deprecated` retires a tag from classification without deleting
its history. Tags are created `active` — by the user, or automatically by the importer for a
category/tag name it has not seen before.

### `classification_runs`

One row per classifier invocation over a bookmark. Immutable (principle 4 — no exceptions).

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

The keyword index is an **internal** structure: FTS5 virtual tables are not `STRICT` and have no
`INTEGER`/UUID primary key. It is queried from server-side search code, never through generated
CRUD. Embeddings, by contrast, live in a normal `STRICT` table (below).

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

`bookmark_id` stores the **BLOB** UUID, so `bookmarks.id = bookmark_fts.bookmark_id` joins
directly in any SQLite connection (no extension needed). Kept in sync with `bookmarks` by
triggers (`AFTER INSERT` / `AFTER UPDATE` / `AFTER DELETE`), recreated with the table in migration
`0001`.

### Semantic search — Qdrant serving, SQLite durable copy

Vectors are stored as little-endian `Float32` BLOBs in a normal `STRICT` table. This table is the
**durable** copy and the rebuild source for the Qdrant collection (one point per row: point id =
bookmark UUID string, cosine space, payload `{ model, dims, categoryId, tagIds }` with keyword
payload indexes on the filter fields, collection metadata `{ model }`). `packages/search` also
loads all rows into one in-memory matrix at startup as the offline fallback; cosine similarity
reduces to a dot product on pre-normalized vectors there. The dimension is fixed by the embedding
model, and all rows must share it (see [ARCHITECTURE.md](./ARCHITECTURE.md#6-search-subsystem)).

**The `model` column stores the active embedding model id — the configured `EMBEDDING_MODEL`
(OpenRouter) or `OLLAMA_EMBED_MODEL` id (dev Ollama route, §8) — never the provider's response
echo** (ARCHITECTURE §8) — a dedicated test pins this rule.

```sql
CREATE TABLE bookmark_embeddings (
  bookmark_id BLOB PRIMARY KEY NOT NULL CHECK (typeof(bookmark_id) = 'blob' AND length(bookmark_id) = 16)
                    REFERENCES bookmarks(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,                        -- active embedding model id (not the provider echo)
  dims        INTEGER NOT NULL,                     -- must equal dimension(model)
  embedding   BLOB NOT NULL,                        -- little-endian Float32 array, length = dims * 4 bytes
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
```

## Invariants & rules

- **No scoping axis.** Every bookmark, category, and tag is a workspace-global row. The classifier
  candidate set is all `active` tags; imports resolve names against the one vocabulary; both search
  paths (keyword and semantic) are unfiltered by anything but the user's query and category/tag
  filters.
- **Uniqueness.** `bookmarks.url` is globally unique; category names are unique among siblings
  (two partial indexes — roots and children); tag names are globally unique; `(bookmark_id,
  tag_id)` in `bookmark_tags` is unique via a `UNIQUE` constraint (not a composite primary key).
- **Tree integrity.** The `categories` self-FK expresses parenthood; cycles and self-parenting are
  prevented **in the app layer** on every parent set and subtree move (SQL cannot express this).
  Depth is unlimited; the UI may render a soft depth cap for ergonomics, but the schema has none.
- **Assignment policy.** A classifier result becomes an effective `bookmark_tags` row only when
  its probability clears the configured `auto_assign` threshold _and_ the tag is `active`.
  Results that fail either test are simply not assigned; manual tagging is the recovery.
- **No classifier-created vocabulary.** The classifier may only select from existing `active`
  tags; unmatched labels are logged and discarded. An importer category or frontmatter tag that
  matches no vocabulary entry is auto-created `active`, as are tags and categories confirmed on
  the setup-wizard suggestion screen.
- **Active by construction.** Only `active` vocabulary is ever assigned or auto-assigned. There is
  no pending or rejected state to review; retiring a tag is `deprecated`, and deleted vocabulary
  is removed outright.
- **Bookmark scrape lifecycle.** Only repeated **dead-link** failures (404/410) move a bookmark to
  `invalid`; the row is retained, excluded from default views and reconciliation, and restored to
  `active` by a successful scrape or a URL edit. Transient failures never invalidate.
- **Referential integrity** is enforced with foreign keys (`PRAGMA foreign_keys = ON`); deletes
  cascade as shown, or set the referencing column to `NULL` where noted.
- **App-generated identifiers.** UUIDv7 primary keys come from `packages/db`
  (`Bun.randomUUIDv7('buffer')`); the schema enforces `typeof(id) = 'blob' AND length(id) = 16`.
- **Server-set timestamps.** `AFTER INSERT` triggers in the migration force `created_at` /
  `updated_at` to server time on every insert, and `AFTER UPDATE` triggers bump `updated_at` —
  client-sent values are always overridden (a raw authenticated UPDATE could still rewrite
  `created_at`; the app never sends it — API-hardening scope).
- **Immutable evidence.** `classification_runs` is insert-only. No UPDATE, no exceptions
  (principle 4); retraction reconciles effective state (`bookmark_tags`) without touching
  evidence.

## Deletion semantics

| Deleted            | Effect                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| profile            | **not deletable** — no delete path exists                                                                                                                    |
| category           | cascades to its **subtree** (children via the self-FK); `bookmarks.category_id` in the subtree is set to `NULL` — bookmarks survive                          |
| bookmark           | cascades to `classification_runs`, `bookmark_tags`, and `bookmark_embeddings`; `bookmark_fts` rows are removed by `AFTER DELETE` triggers (virtual tables cannot be FK targets); the Qdrant point (if any) is deleted best-effort by the API and repaired at the next startup sync |
| tag                | cascades to `bookmark_tags`; classifier runs for bookmarks that used this tag remain                                                                         |
| classification run | `bookmark_tags.run_id` set to `NULL`; effective assignment remains                                                                                           |

## Seed & verification fixture

The synthetic **octocat** demo is the canonical seed and verification fixture
(`packages/db/seeds/octocat.*` — curated, vendorable real well-known URLs under the octocat
profile, source markdown emitted tree-native: H2 → level-1 category, H3 → child category). All
functional integration tests and Playwriter visual QA run against it (ARCHITECTURE §5). Real
profile data (`leo` etc.) is not a fixture; `docs/examples-mds/*` are reserved for much later
import-edge-case tests only and are never product requirements.
