# Design — Profile / dataset / seeding consolidation and data-root layout

> Date: 2026-10-02 · Status: proposed (design only — no code changed) · Related docs:
> [ARCHITECTURE.md](../ARCHITECTURE.md), [MODEL.md](../MODEL.md), [DESIGN.md](../DESIGN.md)

This document investigates whether the single-user **profile**, the **dataset** concept, and
**seeding** should be consolidated, and whether a per-user `data/<user-id>/` folder is a good
deployment shape. It is a proposal only: nothing here has been implemented.

## 1. Verdict

Three instincts, three different answers:

1. **Profile** — add a real, minimal entity. It does not exist today, and it must not be folded
   into `datasets`.
2. **Seed vs. switch** — they are different operations and must be **decoupled**. There is also a
   live **data-loss bug** to fix.
3. **`data/<user-id>/`** — **reject**. Keep a flat, *configurable* `data/` root. The nesting encodes
   a user axis the schema does not have, buys no isolation, and touches every path/config/script.

## 2. Current state (verified)

- **No profile/user entity exists anywhere.** A repo-wide search for
  `avatar|github|profile|user_id|users|account` finds no schema, type, core, server, or web
  matches. "Single user" is entirely implicit.
- **`datasets` is the runtime scoping boundary** (`packages/db/migrations/0003_dataset_vocabulary.sql:11-20`):
  `id` BLOB uuidv7, `name` TEXT unique, `created_at`. A fixed sentinel row
  `X'00000000000000000000000000000001'` named `default` is inserted by the migration (`:20`).
- **Dataset resolution is server-side only.** `packages/core/src/create-core.ts:70-71` does
  `getDatasetByName(db, config.defaultDataset) ?? createDataset(...)` and exposes
  `defaultDatasetId`. Only the import route accepts a `datasetId` query param
  (`apps/server/src/app.ts:355-362`). There is **no dataset list/switch UI**: a search for
  `dataset|Dataset` across `apps/web/src/**/*.tsx` returns zero matches.
- **Seed fixtures are registered in a hardcoded array**: `leo`, `grimoire`
  (`packages/db/src/seed.ts:39-42`), each fixture carrying `dataset`, categories, tags, bookmarks.
- **Storage is global and repo-anchored.** `DB_PATH` / `SCREENSHOTS_DIR` default under `data/`
  (`apps/server/src/env.ts:50-51`); `config/qdrant.yaml:9-10` hardcodes
  `./data/qdrant/{storage,snapshots}`; `data/` and `.tools/` are gitignored. All configuration is
  environment variables (ARCHITECTURE §7); there is no file-based app config today.

### 2.1 Bugs this work must address

- **Critical — `SEED_RESET=1` wipes *all* datasets.** `resetSeedData`
  (`packages/db/src/seed.ts:111-115`) runs unfiltered
  `DELETE FROM bookmarks; DELETE FROM tags; DELETE FROM categories;`, contradicting its own
  docstring ("the wipe is scoped to it"). The correct scoped primitive already exists:
  `clearDatasetContent` (`packages/db/src/queries/datasets.ts:91-101`), used by `db:clear`.
- **High — `DEFAULT_DATASET` is overloaded.** `packages/db/src/seed.ts:19` exports
  `DEFAULT_DATASET = 'leo'` (which seed fixture to load), while `apps/server/src/env.ts:59` reads
  `env.DEFAULT_DATASET ?? 'default'` (which dataset the running app scopes to). The same env name
  means two things with two defaults: `bun run db:seed` loads into `leo`, then `bun run start`
  scopes to `default` → an empty library.
- **Medium — semantic search is not dataset-filtered at Qdrant (latent).** Points are stamped and
  filtered only by `categoryId`/`tagIds` (`packages/vectordb/src/qdrant-index.ts:30-76`;
  `packages/core/src/services/search.ts:116-119`), while the keyword path is dataset-scoped. With
  one populated dataset this is invisible, but it contradicts MODEL.md principle 1
  ("cross-dataset vocabulary leaks structurally impossible") once a second dataset carries
  embeddings.

## 3. Target model

```
profile (singleton: name, avatar_path, github_username)   ← new
  └─ active dataset (DEFAULT_DATASET name → datasets row; sentinel 'default' still valid)
       └─ sections / categories / tags / bookmarks / embeddings   ← unchanged
```

- **`profile` is the person; `datasets` are that person's content workspaces.** They are
  orthogonal. The product already ships two datasets (`leo`, `grimoire`) for one person; if
  dataset meant user, it would already have two users. And `clearDatasetContent` deliberately keeps
  the dataset row "so the name can be reused" (`packages/db/src/queries/datasets.ts:76-78`) —
  behavior that is nonsensical for an identity.
- **No `users` table, no `user_id` columns, no tenancy, no `datasets.is_active`.**
- **Avatar is a file, not a BLOB.** Store under `data/avatars/<uuid>.jpg` and keep a path/URL in the
  row: images are artifacts like screenshots, and a BLOB bloats the single backup file.
- **Profile lives in SQLite**, not a config file — ARCHITECTURE §1.2 (one durable store) and §5
  (backup is a file copy).

### 3.1 Proposed schema (design only)

Forward-only migration **`0007_profile.sql`** (the latest existing migration is `0006`):

```sql
CREATE TABLE profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),   -- singleton
  name            TEXT,
  avatar_path     TEXT,        -- data/avatars/<uuid>.jpg
  github_username TEXT,
  created_at      INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at      INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
```

An `AFTER UPDATE` trigger refreshes `updated_at`, matching the existing server-set timestamp
trigger pattern.

## 4. Data root: flat and configurable

Recommended layout — **no user-id segment**:

```
data/                      # DATA_DIR (env; default repo ./data)
  bookmarks.db  + -wal/-shm
  screenshots/
  avatars/                 # profile avatar files
  qdrant/
    storage/
    snapshots/
```

Why **not** `data/<user-id>/`:

- It encodes a filesystem user axis with no schema backing — `datasets` has no user link, so the
  directory would be born inconsistent with the data model.
- One Qdrant sidecar (fixed port `6333`, static yaml, one `storage_path`) cannot honor per-user
  paths without a process-per-user or collection-per-user scheme. Neither is warranted.
- It touches `DB_PATH`, `SCREENSHOTS_DIR`, the screenshot serve root, `qdrant.yaml`, and the
  seed/clear/backup/deploy scripts, yet adds **no isolation** (still one SQLite file, one Qdrant
  process).
- Per-*dataset* separation already lives in the DB (`datasets` table), which is where MODEL.md puts
  it.

Portability — the legitimate goal behind the proposal — is met with a single **`DATA_DIR`** env
knob; derive `bookmarks.db`, `screenshots/`, `avatars/`, and the Qdrant yaml paths from it. Revisit
per-user nesting only when a second user is actually requested, which itself reopens ARCHITECTURE
§1.3.

## 5. Proposed implementation lanes (future work — not executed)

1. **Bugfixes (independent, do first).**
   - Replace `resetSeedData` with a dataset-scoped `clearDatasetContent(db, datasetId)` call:
     resolve/reuse the fixture's dataset first, clear that id, then load. Delete the old function
     and its incorrect docstring.
   - Unify `DEFAULT_DATASET` to one active-dataset name shared by seed and server; align
     `.env.example` and docs. `db:seed` should not implicitly switch the app — print the matching
     `DEFAULT_DATASET=<name>` (and warn on mismatch) instead.
2. **Profile entity.**
   - Migration `0007_profile.sql` (schema in §3.1) + singleton row.
   - `packages/db/src/queries/profile.ts` (`getProfile` / `updateProfile`; no SQL outside `db`).
   - `packages/core/src/services/profile.ts` (transport-neutral; avatar write injected as a port,
     mirroring `screenshotsDir`).
   - `apps/server`: `GET`/`PATCH /api/profile`, guarded avatar serving route, avatar file-write
     adapter at the app edge.
   - `packages/shared`: `Profile` DTO.
   - `apps/web`: surface profile in the Topbar (avatar + name); route UI work through DESIGN.md.
3. **Data root (optional, separate commit).** Add `DATA_DIR`; derive db/screenshots/avatars/Qdrant
   paths from it. Default stays repo `./data`.
4. **Follow-up.** Push `datasetId` into the Qdrant payload + filtered top-k so semantic search
   matches MODEL.md §1 (the keyword path already is).

## 6. Documentation impact (when implemented)

- **MODEL.md** — new `profile` table + a principle ("profile is a singleton; datasets are content
  workspaces"); entity overview; deletion semantics (the profile row is not deletable); clarify the
  sentinel dataset is an internal backfill target.
- **ARCHITECTURE.md** — §1.3 (profile vs datasets), §3/§4 (profile service/route), §5 (`DATA_DIR`,
  `avatars/`, datasets ≠ users), §7 config table (fix `DEFAULT_DATASET` meaning and
  `SEED_DATASET`/`SEED_RESET` semantics), §9 (avatars in backup scope), §11 (revisit triggers:
  second user → tenancy; dataset-switch UI → `active` flag), §6 note (dataset filter into Qdrant).
- **.env.example** — align `SEED_DATASET`/`DEFAULT_DATASET`, document `DATA_DIR`, remove the
  misleading `SEED_RESET` implication.

## 7. Rejected as over-engineering

`users` table · `user_id` foreign keys · row-level scoping · `datasets.is_active` · dataset-switch
API/UI · per-user Qdrant storage or ports · profile in a JSON config (a second durable store) ·
`data/<user-id>/` nesting.

## 8. Risks

| # | Risk | Severity | Mitigation |
| - | ---- | -------- | ---------- |
| 1 | `SEED_RESET=1` wipes all datasets globally (`packages/db/src/seed.ts:111-115`) | Critical (data loss) | Fix via scoped `clearDatasetContent`; correct docstring; test |
| 2 | `DEFAULT_DATASET` overload → empty app after seed (`seed.ts:19`, `env.ts:59`) | High (broken path) | Unify to one active-dataset name; seed prints/warns |
| 3 | Profile folded into datasets → identity changes on switch; muddled backup | Medium | Separate `profile` singleton |
| 4 | `data/<user-id>/` encodes a user axis absent from schema | Medium | Keep flat `data/`; use `DATA_DIR` |
| 5 | Qdrant semantic search lacks `datasetId` filter | Medium (latent leak) | Add payload + filter when >1 dataset can hold embeddings |
| 6 | Avatar outside the data root → not backed up | Low | Store under `data/avatars/` |
| 7 | Profile stored in a config file → second durable store | Low | SQLite singleton |

## 9. Open questions

1. Is the profile **required** or optional — does the app run fine with no `profile` row?
2. Avatar source: local upload only, or also fetch/derive from the GitHub username?
3. Adopt `DATA_DIR` now, or defer until a deployment move is actually needed?

## 10. Verification (when implemented)

- `bun test` — add/extend a seed test proving `SEED_RESET` leaves other datasets intact; extend
  `packages/db/tests/clear-dataset.test.ts`.
- `bun run typecheck`, `bun run lint`, `bun run build`.
- Manual: seed `grimoire` with `SEED_RESET=1` after seeding `leo`; assert `leo` survives.
