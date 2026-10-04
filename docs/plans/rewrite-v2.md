# al-yo-bo v2 — full rewrite, specs-first

> Approved 2026-10-04 (Leo): full greenfield rewrite instead of incremental phases A–D.
> Categories are **sibling-unique** `(parent_id, name)`.
> Supersedes [rewrite-research.md](./rewrite-research.md) as the execution plan; that document
> stays as the research record (and the PocketBase re-entry alternative, its §2.4).

**Rationale:** the repo is 6 days old, pre-release, `data/` is disposable, and ~25–35% of the
incremental plan's critical path was migration/transition tax for data that can be deleted with
`rm`. The rewrite builds the final model from day one and ports the test suites as the acceptance
harness.

**Non-negotiable disciplines (the rewrite fails without these):**

1. **Specs first (R0)** — MODEL.md v2 + ARCHITECTURE.md v2 written against the final shape *before*
   line one of code. This is the go/no-go.
2. **Tests port before code (R1)** — the ~4.8k existing test lines are the project's transferable
   memory.
3. **Copy-edit, don't reinvent** the subtle packages — only open the editor to delete
   dataset/section scoping.

---

## 0. Repo strategy

- Tag current HEAD as `legacy` (read-only reference spec; diffs old→new are review artifacts until
  R5 ships).
- Rebuild on `main` in the same repo. History preserved; old code reachable via the tag. `data/`
  is dev data — reseeding expected.
- `docs/plans/rewrite-research.md` is superseded by this plan (kept as research record; decisions
  it confirmed carry into §1 below).

## 1. What evaporates vs. carries over

**Evaporates (existed only for legacy data):** migration 0009 and all in-migration dedupe/cascade
rules; tag-dedupe precedence + assignment-merge rules; category collision rules; A1/A2 sequencing;
`resolveActiveDataset` / `DEFAULT_DATASET` / `profile.active_dataset_id`; the section↔category
two-level split; the importer's H2/H3 flattening and exporter's `## Section`/`### Category`
grouping; the immutability carve-out — **MODEL.md v2 states evidence immutability without
exception**.

**Carries over as day-one spec (decided, written into the v2 docs):**

- **H3 (decided: sibling-unique):** `UNIQUE(parent_id, name)` via two partial unique indexes
  (tags-table pattern) — allows `web/2024` and `books/2024`.
- **H4 real-time semantics:** coarse lossy events that only trigger refetches; on SSE
  reconnect-open the client does `queryClient.invalidateQueries()` (or server sends synthetic
  `invalidate-all`); listen to error/reconnect, not just messages; multi-tab = one stream per tab.
- **H5 emission layer:** core services emit events; `packages/db` never emits; seed/CLI/
  out-of-process writers are event-silent (documented in ARCHITECTURE v2 §4/§9).
- **M2 export formats:** JSON export starts at version 2 with the category tree (path as array);
  Netscape folders = category ancestor chain; CSV folder = parent-joined path. One path grammar,
  decided once.
- **M3 `packages/ai` layout:** interfaces (`EmbeddingClient`, `ClassifierClient`) consumed by core;
  concrete adapters constructed only by server. The ARCHITECTURE §4 dependency diagram was written
  before the package.
- **M4 embeddings model-storage rule:** `bookmark_embeddings.model` stores the configured
  `EMBEDDING_MODEL`, never the provider echo — with a dedicated test.
- **Reorder keys:** fractional indexing (not integer reindex) for drag-reorder `sort_order`.
- Tree cycle enforcement at app layer (on parent-set and subtree-move); classifier invariants
  (never invent vocabulary, active-only auto-assign, user rows win); graceful degradation posture;
  one durable SQLite; db owns SQL; UUIDv7 BLOB conventions — restated unchanged.

## 2. Carry-over table

| Port nearly as-is (copy-edit; only delete scoping) | Notes |
|---|---|
| `packages/search` (rrf, knn, fallback, index) + its tests | Tuned behavior: RRF k=60, 8× overfetch, cooldowns. Only `VectorFilter.datasetId` drops |
| `packages/vectordb` (qdrant-index) + tests | Payload becomes `{ model, dims, categoryId, tagIds }`; rebuild-from-SQLite invariants survive |
| `packages/classifier` + `core/enrichment/classify.ts` + its 373 test lines | Candidate query simplifies to "all active tags"; tests are the regression oracle for that behavioral change |
| `packages/importer` + fixtures/snapshots | Parser becomes H2 → level-1 category, H3 → child (tree-native); expectation updates only |
| `packages/exporter` serializers + tests | Regroup from tree; fixtures port |
| `packages/db` scaffolding | Connection/PRAGMA/uuid/row-mapping/migrations-runner conventions — not schema |
| Scrape/screenshot job ladder + dead-link lifecycle | Orthogonal to the model change |

**Re-derived deliberately:** all `queries/*.ts` touching datasets/sections/tags (`sections.ts`
deleted), `create-core.ts` boot, server route scoping, and all of `apps/web`
(simplification-bearing; DESIGN.md system unchanged).

## 3. Build order (each phase ends green)

- **R0 — Specs:** MODEL.md v2 + ARCHITECTURE.md v2 against the final shape, folding in every §1
  carry-over. Includes an honest re-read of ARCHITECTURE §7 (why dataset scoping existed —
  demo-vocabulary leakage — and why one workspace removes it) and the **canonical verification
  fixture spec** (§4). DESIGN.md unchanged.
- **R1 — Preserve the oracle:** tag `legacy`; port test suites first per package (search,
  vectordb, classifier-evidence, importer/exporter, jobs) adapted to the new model — red tests
  defining parity, then port packages until green.
- **R2 — DB skeleton:** Bun workspace; `packages/db` born at migration `0001` (no datasets/
  sections ever): profile singleton, categories tree (sibling-unique), bookmarks (global URL
  unique), tags (global name unique, no category_id), bookmark_tags, classification_runs/results
  (immutable), FTS5 + trigger sync, embeddings BLOBs with configured-model rule; seed rebuilt
  around the **octocat fixture as the canonical seed** (§4).
- **R3 — Core + server:** core services on the new model (no scoping resolution anywhere) emitting
  events per H5; Hono routes; boot capability probes / degrade flags.
- **R4 — Web:** React 19 against the final schema from the first component — sidebar as tree with
  fractional-order drag from day one; vocabulary, import/export, classifier review, chat. **End of
  R4 = feature parity with the old plan's phase-A target.**
- **R5 — Real-time:** event bus → `streamSSE` → TanStack invalidation, with H4 reconnect
  semantics; job-progress events (scrape→embed→classify) surface live.
- **R6 — AI + MCP:** `packages/ai` per M3/M4 (absorb embeddings + classifier config); bookmarks
  MCP server on MCP TS SDK v2 + Hono adapter (loopback bind, Host/Origin guard, `MCP_TOKEN`
  bearer env), read-only tools + `bookmark://{id}` resources.

## 4. Verification — real-data fixture

**Canonical fixture: the synthetic `octocat` demo** (`packages/db/seeds/` — curated, vendorable
real well-known URLs under the octocat profile, ~25 bookmarks across GitHub / AI tools / Dev tools
/ Learning / Design, source `octocat.md`). It is the single real-data verification set for v2:

- **Adapt to v2 in R0/R2:** re-emit the fixture in the new seed format — markdown source as the
  tree-native import file (H2/H3 → category tree), no dataset layer; the v2 `db:seed` loads it by
  default (the `SEED_DATASET`/`SEED_*` dataset knobs disappear).
- **Functional verification (every phase from R2 on):** seeded octocat data drives integration
  tests — import round-trip (markdown → db → JSON/Netscape/CSV/markdown export), FTS+vector search
  sanity queries with expected hits, classifier run/evidence shape, aggregates. Ported unit suites
  (§2) remain the behavioral oracle; the fixture adds the end-to-end real-data layer on top.
- **Visual verification (R4 onward):** Playwriter sessions (headed project profile
  `./.playwriter-profile` per AGENTS.md; disposable headless `--browser headless` for agentic QA)
  run scripted flows against the seeded app — sidebar tree navigation + drag-reorder, vocabulary
  page, import/export, classifier review, chat — with screenshot evidence checked into
  `.omo/evidence/` (gitignored runtime state, not fixtures).
- **Dropped:** the `leo` and `grimoire` real-profile seeds — Leo's actual profile/dataset is not
  carried into v2 fixtures; dev data is disposable and reseeding is sanctioned.
- **Deferred:** `docs/examples-mds/*` (real user collections, per AGENTS.md used *only* as
  import-format examples) reserved for a much later phase — import-format edge-case/stress tests
  only, never early verification, and their content never treated as product requirements.

**Per-phase gates:** `bun run lint`, `bun run typecheck`, `bun test` green; ported tests pass
unmodified where behavior is unchanged (search/vectordb/classifier/jobs); modifications allowed
only for expected behavioral deltas (importer tree shape, classifier candidate set). Browser QA
via Playwriter after R4/R5.

## 5. Risks & protections

- **Tacit-knowledge loss** (RRF tuning, overfetch factors, cooldowns, model-echo trap, strict-FK/
  UUID hygiene, dead-link taxonomy) → R1 tests-first porting + `legacy` tag + copy-edit discipline.
- **Long-red period** → mitigated by per-package green in R1–R3; each phase demonstrable;
  octocat-seeded integration tests from R2 onward keep a runnable app visible early.
- **Forgotten load-bearing use case** for dataset scoping → R0's honest re-read of ARCHITECTURE §7
  (it existed to stop demo-vocabulary leakage; one workspace + scratch `DATA_DIR` removes it).
- **Motivation drag** → scope is ~26k LOC, parity reachable at R4; total effort strictly below
  incremental A–D.
