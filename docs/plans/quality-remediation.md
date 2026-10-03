# Code Quality Remediation Plan

Durable cross-session execution plan produced from the pre-feature code quality review
(2026-10-03). Two parallel review lanes audited the backend (architecture, correctness,
type safety, tests, perf) and `apps/web` (design-system conformance, a11y, data layer).

**Baseline at review time:** `typecheck` ✅ · `lint` ✅ (warnings only) · `bun test` 217/217 ✅ ·
zero `as any`/`@ts-ignore` · dependency graph clean.

## How to use this plan

- Work top-down. Check off items only after gates pass.
- Gates before every commit: `bun run typecheck && bun run lint && bun test`.
- Commit style: semantic prefixes, one concern per commit (`fix:`, `docs:`, `chore:`, `refactor:`).
- Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` deferred (with reason).

---

## Phase 0 — Upgrades (done first, no approval needed)

- [x] Check bun binary upgrade (`bun upgrade`) and `bun outdated`; apply in-range updates
      (`bun update`), evaluate majors against the gates, revert any major that breaks.
- [x] Sidecar binaries: Qdrant 1.19.1 = latest release (matches `install.sh` pin); Ollaya 0.9.0 =
      latest (reinstalled, sidecar restarted). Fixed `scripts/ollaya/start.sh` (`--host` flag
      rejected by `ollaya serve`; now exports `OLLAYA_HOST`).
- [x] Note applied versions in the commit message (`chore: update deps`). — nothing to update;
      all current.

## Phase 1 — P0 fixes (blockers before any new features)

### 1.1 Vector: memory/fallback path drops all filters (dataset leak) — DONE `90dc234`
- Files: `apps/server/src/vector.ts:118–142`, `packages/search/src/knn.ts:137–141`,
  `packages/search/src/fallback.ts:108–122`, `packages/core/src/services/search.ts:119–123`.
- Bug: bare `KnnIndex` returned on the `QDRANT_URL=''` path and the boot-failure catch;
  `KnnIndex.search` ignores `_filter`. Only the Qdrant-success path wraps KNN in
  `FallbackVectorIndex` (8× overfetch + client-side filter). Degraded semantic search can
  return other datasets' bookmarks and ignores category/tag filters.
- Fix (as implemented): new `FilteringVectorIndex` decorator in `packages/search` (shares
  `filterCandidates` with the fallback path); both memory paths in `apps/server/src/vector.ts`
  route through it. `backend` still reports `'memory'`.
- Test: `packages/search/tests/filtering.test.ts` — dataset/category/tag filtering on the real
  memory path, rank preservation, unfiltered top-k.

### 1.2 Importer: re-import replaces metadata (destroys scrape provenance + image refs) — DONE `90dc234`
- Files: `packages/importer/src/ingest.ts:135–150`, `packages/db/src/queries/bookmarks.ts:207–214`.
- Bug: `updateBookmark` replaces `metadata` wholesale; each re-import wipes `metadata.scrape`
  (lastError/finalUrl/truncated) and `metadata.image`, and re-triggers screenshot/og discovery
  (`listBookmarkIdsMissingScreenshot`). ARCHITECTURE §7 promises merge-by-URL.
- Fix (as implemented): shallow-merge in the db layer — `upsertBookmarkByUrl` merge branch does
  `{ ...existing.metadata, ...input.metadata }`; `updateBookmark` stays a replace-setter for
  internal writers that merge manually.
- Test: `packages/importer/tests/importer.test.ts` re-import regression (scrape/image survive,
  `metadata.import.file` refreshed).

### 1.3 Classifier: re-runs never retract stale assignments — DONE `5bb20a4`
- Files: `packages/core/src/enrichment/classify.ts:159–185`,
  `packages/db/src/queries/classification.ts` (`reconcileClassifierAssignments`),
  `packages/core/tests/classify.test.ts`.
- Bug: policy only wrote `bookmark_tags` rows; tags assigned under an old policy/threshold
  stuck forever; `selected` flags drifted from immutable evidence.
- Fix (as implemented): after a run, classifier-sourced rows for affected bookmarks whose tags
  were not re-qualified are retracted (dataset-scoped, `source='classifier'` only — user/import
  rows untouched); `selected` reconciled to the latest run; evidence rows immutable; vector
  payload resynced on assign/retract. `ClassifyOutcome` gained a `retracted` count.
- Tests: retraction on below-threshold re-run, user/import survival, `selected` reconciliation,
  evidence immutability. Wrong vocabulary comment in `review.ts` fixed in the same commit.

### 1.4 Web: shadow-removal pass on `ui/*` (elevation policy) — DONE `740aabb`
- Files: `apps/web/src/components/ui/{card,button,input,select,dialog,alert-dialog,sheet,command,dropdown-menu,table,empty,tabs}.tsx`,
  `badge.tsx:7` (`rounded-4xl` → pill/token), `agents/message-bubble.tsx:342` (hardcoded `#000`
  mask → token), `ui/badge.tsx:4` (`cn` import from `"cn"` → `@/lib/utils`).
- Bug: generated primitives used shadows pervasively; DESIGN.md elevation policy allows shadows
  only on overlays (popover, dropdown, command palette, sheets).
- Fix (as implemented): non-overlay shadows + pseudo-shadow layers removed from card, button,
  input, select trigger, table (card variant), empty, tabs, command panel; overlays (dialog,
  alert-dialog, sheet, popover, dropdown-menu, command/select/autocomplete popups) keep their
  floating shadows. `badge.tsx` → `rounded-full` + alias import; mask hex → `var(--color-black)`.

### Phase 1 gates
- [x] Full gates: `bun run typecheck` (all 10 packages), `bun run lint` (warnings-only,
      pre-existing), `bun test` 227/227 across 23 files (up from 217 — new regression tests).
- Manual smoke (optional, covered by automated tests): dev boot with `QDRANT_URL=''` → semantic
  search scoped to active dataset (`filtering.test.ts` exercises the real memory path); re-import
  preserves provenance (importer regression test); classifier re-run retracts (classify suite).

## Phase 1.5 — Doc drift sweep (single `docs:` commit)

Update docs to match reality; where Phase 1 changes behavior, describe the new behavior:

- [x] §4 "shared … no Bun-specific runtime" vs `packages/shared/src/uuid.ts:37–43`
      (`Bun.randomUUIDv7`) — documented as a known server-only exception with a pointer to 2.3
      (the code split itself remains P1 2.3).
- [x] §6 Qdrant sync described as replay/orphan-delete vs full delete-all + re-upsert
      (`packages/vectordb/src/qdrant-index.ts:326–369`) — doc aligned with implementation
      (full rebuild by design; revisit ~50k rows).
- [x] §6 "filters applied client-side after 8× overfetch on the fallback path" — restated:
      filters apply on every backend path (`FilteringVectorIndex` wraps the memory KNN).
- [x] §7 EXTRACT_MODEL config table — documents actual behavior (non-`/` id not honored by the
      Ollama client; read from `process.env`); the code fix remains P1 2.4.
- [x] §4 layout line `search/ FTS5 + RRF` → "RRF fusion + in-process KNN + client-side
      filtering" (FTS5 SQL lives in db, by rule).
- [x] §7 Stage 4/6 retraction semantics — explicit "Retraction (decided)" paragraph added
      (matches the 1.3 implementation).
- [x] `packages/core/src/services/review.ts:7–9` comment said classifier creates vocabulary —
      fixed in the 1.3 commit.
- [x] MODEL.md §5 migration sentinel wording — precedence now reflects `resolveActiveDataset`
      (sentinel is the `default` dataset, covered by the name fallback).
- [x] DESIGN.md: Share page documented (Tools/footer lists, surface table, "Share page" section).

## Phase 2 — P1 (architecture / robustness) — DONE

- [x] 2.1 Cross-dataset assignment guard — DONE `2346492`. Guards in core services
      (bookmarks `assignTag`/create/update category, vocabulary `createTag`/`updateTag`,
      review `acceptCandidate`); malformed body/query ids → 400 at the edge (`requiredUuid`/
      `queryUuid` in `app.ts`). Tests: dataset-boundary suites in core.
- [x] 2.2 Review queue hygiene — DONE `ba0389e`. `listBelowThresholdCandidates` rewritten as a
      latest-run-per-pair CTE + `NOT EXISTS` anti-join on `bookmark_tags`. Tests: queue
      exclusion/dedupe/accept-clears in `db.test.ts`.
- [x] 2.3 `packages/shared` Bun split — DONE `f0782ce`. Pure codec stays in shared
      (`uuid-codec.ts`); generator relocated to `packages/db/src/uuid.ts`; web build verified
      Bun-free.
- [x] 2.4 `EXTRACT_MODEL` threading — DONE `78bb3c5`. Flows through `ServerConfig`;
      non-`/` id wins on the Ollama path. Tests: `apps/server/tests/extract.test.ts`.
- [x] 2.5 Web keyboard/touch — DONE `44d35e2`. Explicit Enter open, delete via confirm dialog,
      coarse-pointer action visibility, topmost-overlay Escape ordering, popup-aware shortcut
      guard, visible-label accessible name, `TagPill` in classifier suggestions.

## Phase 3 — P2 (quality / maintainability)

- [ ] 3.1 Remove `drain.ts` + boot queue shim remnants (dead after migration 0004); until then
      move `JSON.parse` inside try (`packages/core/src/drain.ts:68`).
- [ ] 3.2 Importer frontmatter heuristic: require offset-0 block or a recognized key; warn on
      consumed non-tag keys (`packages/importer/src/parse.ts:141–186`).
- [ ] 3.3 Screenshot adapter: abort-on-timeout, close WebView in `finally`, attribute-order-safe
      og:image regex, cap og:image download size (`apps/server/src/screenshot.ts:37–109`).
- [ ] 3.4 Embeddings: batch re-embeds via `embed(texts: string[])`; bump `updated_at` on
      `bookmark_embeddings` upsert (`packages/db/src/queries/embeddings.ts:86–96`).
- [ ] 3.5 Web dedup: shared `resolveImageSrc` (`lib/image.ts`), one `FilterTagPill`, shared
      collapsed/expanded nav tree, `createSafeStorage` utility; hoist inline render-props
      (~40 oxlint warnings); `useMutation` for async writes (VocabularyPage double-submit);
      remove unused `zustand`; fix oxlint warnings (deps/shadow/unassigned-import).
- [ ] 3.6 Dead API surface: honor or remove `SearchQuery.dateFrom/dateTo`; surface FTS
      `snippet` in `SearchResponse.items`; emit real import warnings
      (`packages/core/src/services/import.ts:67`).
- [ ] 3.7 Shared helpers: `describeFetchFailure` → shared (dup in embeddings + classifier);
      `requireBookmark` 404 helper; slim `ImportReport.bookmarks` echo in commit response.
- [ ] 3.8 Stale types: drop `status`/`merged_into_id` from row mappings
      (`packages/db/src/row-mapping.ts:32–62`).

## Deferred / notes

- Qdrant boot sync is full re-upsert by design (commented); revisit at ~50k rows.
- Optimistic updates in web: acceptable to skip for v1.
