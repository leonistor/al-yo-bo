# Code Quality Improvements Plan

Date: 2026-10-01
Source: full code-quality review (three parallel @oracle reviews + quality gates: typecheck 10/10 ✅, tests 151/0 ✅, lint 0 errors / 99 react-perf warnings).
Status: complete — all steps implemented and committed.

## Progress

**Complete — all steps implemented, verified, and committed (2026-10-01).**

- Step 1 (timeouts): committed 3d456ae, 297a22a, 756b912.
- Step 2 (vector integrity): committed e3eabeb, 385a956 (verified incl. live Qdrant; full-rebuild sync observed on a real boot: `upserted 139, deleted 139`).
- Step 3a (importer/core fixes): committed fd485cb, 1782333.
- Step 3b (migration 0005 + FTS snippet): committed 8bef74f.
- Step 3c (unknown-label evidence): committed 4b20a5d (MODEL.md + migration 0006).
- Step 4.0 decision (Leo, 2026-10-01): **adopt TanStack Query**; SWR eliminated (no cancellation/partial invalidation/offset pagination).
- Step 4 (web data layer): committed 1e2ae4b; browser QA passed (search, filters, dialog, add/remove-tag invalidation cycle).
- Step 5 (minor cleanups): committed 725f0e7, c036182, 9158d96, 1fce8c4, b7abe4a; browser smoke passed after the component restructure.
- Side task (Leo, 2026-10-01): project-scoped Playwriter QA browser wired (`browser:install` /
  `browser:start`, headed Chrome for Testing + `./.playwriter-profile`, extension auto-loaded).

## Final state

- Gates: typecheck 10/10 packages, tests 183 pass / 0 fail (baseline 151), build green,
  lint 0 errors and 19 warnings (baseline 99 — all react-perf warnings eliminated).
- Review items resolved: every critical and major finding from the 2026-10-01 code-quality
  review, plus the minor batch. Findings intentionally not addressed: none — one false-positive
  review claim (optimistic tag removal) was rejected during reconciliation.
- Residual risks flagged during work: `getTagsForBookmarks` IN-list stays unchunked (all current
  callers bounded ≤500); Qdrant full-rebuild sync re-upserts everything on startup — upgrade to
  content-hash diffing if startup latency ever matters (documented in qdrant-index.ts).

## Step 1 — Timeouts on sidecar & subprocess waits (critical)

Goal: the sequential worker can never hang forever.

- Add configurable timeouts (`AbortSignal.timeout`, default 30s) to:
  - `packages/embeddings/src/index.ts:41` (OpenRouter fetch)
  - `packages/classifier/src/index.ts:50` (Ollaya fetch)
- Kill the `html-to-markdown` subprocess on timeout: `packages/core/src/scrape.ts:93-109` (race `proc.exited` against a timer, `proc.kill()` on abort).
- Surface timeouts as upstream/unavailable errors so the existing degradation paths (fallback index, skip-job) engage.
- Validation: unit tests with a deliberately slow/stuck endpoint asserting the fallback engages.
- Lane: bounded @fixer task. No design decisions needed.

## Step 2 — Vector data integrity (critical)

Goal: the "SQLite is source of truth; Qdrant is rebuildable" invariant actually holds.

- **Decided:** `sync()` goes with a full rebuild — delete-all + batch re-upsert of the full SQLite set on startup. Simpler and obviously correct; fine at personal scale. Upgrade to per-record content-hash re-upserts only if startup latency ever becomes a problem.
- Fix `KnnIndex.upsert()` mutating the caller's vector (normalize in place): copy with `Float32Array.from(...)` first — `packages/search/src/knn.ts:83-103`.
- While here (minor): `ensureCollection()` should treat missing `model` metadata as a mismatch when a model is configured — `packages/vectordb/src/qdrant-index.ts:199-201`.
- Validation: test that a changed embedding in SQLite is re-upserted after `sync()`; test that `upsert()` leaves the caller's array unmutated.
- Lane: bounded @fixer task (design decided above).

## Step 3 — Invariant & correctness fixes (major)

- **Migration 0004 orphans:** delete `classification_results` / `bookmark_tags` rows pointing at rejected tags before `DROP TABLE tags` — `packages/db/migrations/0004_simplify_vocabulary.sql:69-90`. Check whether 0004 has shipped anywhere; if it may already be applied, ship the cleanup as a new migration instead of editing 0004.
- **Deprecated-tag import:** skip non-active tags with a warning — `packages/importer/src/ingest.ts:76-79` (+ test).
- **FTS snippet targets wrong column:** index 3 (`description`) → 4 (`content`), add title fallback for empty snippets — `packages/db/src/queries/bookmarks.ts:408-417` (+ test).
- **URL parser strips valid trailing `)` / `]`:** paren-aware stripping — `packages/importer/src/parse.ts:188-190` (+ fixture test, e.g. `https://en.wikipedia.org/wiki/Foo_(bar)`).
- **Early URL validation:** `isHttpUrl` checks in `core/services/import.ts:100-108` and `core/services/bookmarks.ts:89-112` → `ValidationError` / skip invalid import rows.
- **Unknown classifier labels as durable evidence:** schema change (`unknown_classification_labels` table or nullable `classification_results.tag_id` + `raw_label`). Update `docs/MODEL.md` first per repo rules, then implement — `packages/core/src/enrichment/classify.ts:146-157`.
- Lane: two parallel @fixer tasks, scoped per folder (importer/core vs db), non-overlapping.

## Step 4 — Web data layer (critical, amended per Leo)

- **4.0 (research, first): Are React Query or SWR useful here?** Evaluate TanStack Query / SWR against the current manual pattern (`useState` + `useCallback` refresh in `App.tsx:179-208`, ~15 components fetching). Assess: server-state caching vs local-state needs, filter/pagination re-fetches, race-condition handling, mutation + invalidation flow (tag add/remove, import), bundle cost, and fit with the Hono RPC client. Note: AGENTS.md requires user approval for new dependencies — output is a recommendation + integration sketch, gated on Leo's decision before any implementation.
- 4.1 Chat transport recreated per render → `useMemo` — `apps/web/src/components/ChatPanel.tsx:64-69`.
- 4.2 Fetch race in `App.tsx:179-208` (stale overwrites fresh): abort stale generations or adopt the data library chosen in 4.0.
- 4.3 `unwrap<T>` casts bypass the Hono RPC contract — `apps/web/src/lib/client.ts:25-42`: use typed RPC responses or route through `unknown` with runtime validation.
- 4.4 Hardening: guard `localStorage` reads (`useLayout.ts:9`, `useTheme.ts:20`); wrap `ImportPage.readFile` in try/catch with toast feedback.
- Validation: typecheck + lint + browser QA; the App.tsx react-perf warnings should drop naturally if 4.0→4.2 reshapes the data layer.

## Step 5 — Minor cleanups (opportunistic batch, final)

- Cache prepared statements for fixed SQL (`packages/db/src/queries/*.ts`).
- Chunk `IN (...)` lists to ≤500 IDs (`db/src/queries/bookmarks.ts:250-266, 350-367`).
- Wrap `create*` helpers in `db.transaction(...).immediate()` (`datasets.ts`, `bookmarks.ts`, `categories.ts`, `tags.ts`, `sections.ts`).
- Health probe: use `response.ok` (`core/src/services/health.ts:100-103`).
- Wrap `resolveVocabulary` in a transaction (`importer/src/ingest.ts:59-82`).
- UUID-validate `tagId` path param and import `datasetId` query (`server/src/app.ts:232-237, 349-354`).
- Extract duplicated image-resolution logic (`BookmarkList.tsx` / `BookmarkDetailDialog.tsx`) and keyword filter builder (`keywordSearch` / `countKeywordMatches`).
- Fix unreachable `'disabled'` branch in screenshot log (`server/src/index.ts:136`).
- Remaining `react-perf` lint warnings pass in `App.tsx` (24) and `Sidebar.tsx` (9).
- Validation: full gates (lint, typecheck, `bun test`) + browser QA.

## Sequencing & rules

- Steps 1–3 touch disjoint packages → parallel @fixer lanes are safe; step 4 blocks on the 4.0 research gate; step 5 last.
- Each step: `bun run lint` + `bun test` before committing; semantic commit prefixes; one concern per commit; no pushes without approval.
- Docs: update `docs/MODEL.md` with the evidence-table change (step 3); update this file marking steps implemented as they land.