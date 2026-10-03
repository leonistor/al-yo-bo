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
- [ ] Note applied versions in the commit message (`chore: update deps`).

## Phase 1 — P0 fixes (blockers before any new features)

### 1.1 Vector: memory/fallback path drops all filters (dataset leak)
- Files: `apps/server/src/vector.ts:118–142`, `packages/search/src/knn.ts:137–141`,
  `packages/search/src/fallback.ts:108–122`, `packages/core/src/services/search.ts:119–123`.
- Bug: bare `KnnIndex` returned on the `QDRANT_URL=''` path and the boot-failure catch;
  `KnnIndex.search` ignores `_filter`. Only the Qdrant-success path wraps KNN in
  `FallbackVectorIndex` (8× overfetch + client-side filter). Degraded semantic search can
  return other datasets' bookmarks and ignores category/tag filters.
- Fix: always wrap KNN in the filter-applying layer (reuse `FallbackVectorIndex` with an
  unreachable primary, or extract a `FilteringVectorIndex` decorator) so filter semantics are
  identical on every backend path.
- Test: search-service test asserting dataset/category/tag filtering on the memory path.

### 1.2 Importer: re-import replaces metadata (destroys scrape provenance + image refs)
- Files: `packages/importer/src/ingest.ts:135–150`, `packages/db/src/queries/bookmarks.ts:207–214`.
- Bug: `updateBookmark` replaces `metadata` wholesale; each re-import wipes `metadata.scrape`
  (lastError/finalUrl/truncated) and `metadata.image`, and re-triggers screenshot/og discovery
  (`listBookmarkIdsMissingScreenshot`). ARCHITECTURE §7 promises merge-by-URL.
- Fix: shallow-merge on ingest (`{ ...existing.metadata, import: {...} }`) — read existing row
  first or use `json_set` in the db layer.
- Test: re-import preserves pre-existing `metadata.scrape`/`metadata.image`.

### 1.3 Classifier: re-runs never retract stale assignments
- Files: `packages/core/src/enrichment/classify.ts:159–185`,
  `packages/db/src/queries/` (add retraction query), `packages/core/tests/classify.test.ts`.
- Bug: policy only writes `bookmark_tags` rows. Tags assigned under an old policy/threshold
  stick forever; effective state drifts from immutable evidence (contradicts §7 Stage 4/6:
  "effective state is recomputed under the current policy").
- Fix: before applying a run's results, delete `source='classifier'` rows for in-scope
  (bookmark, tag) pairs not re-qualified by this run. Never touch `source='user'`/`'import'`.
  Keep `classification_results` immutable; reconcile `selected` flags.
- Test: re-run retraction regression (below-threshold now → row removed; user rows win).

### 1.4 Web: shadow-removal pass on `ui/*` (elevation policy)
- Files: `apps/web/src/components/ui/{card,button,input,select,dialog,alert-dialog,sheet,command,dropdown-menu,table,empty,tabs}.tsx`,
  `badge.tsx:7` (`rounded-4xl` → pill/token), `agents/message-bubble.tsx:342` (hardcoded `#000`
  mask → token), `ui/badge.tsx:4` (`cn` import from `"cn"` → `@/lib/utils`).
- Bug: generated primitives use shadows pervasively; DESIGN.md elevation policy allows shadows
  only on overlays (popover, dropdown, command palette, sheets).
- Fix: remove non-overlay shadows (`shadow-xs/sm/md/lg` + pseudo-shadows), keep overlay shadows;
  keep token radii; do not otherwise restyle components.

### Phase 1 gates
- Full gates + `bun run build`. Manual smoke: dev boot with `QDRANT_URL=''` → semantic search
  scoped to active dataset; re-import an example collection; classifier re-run.

## Phase 1.5 — Doc drift sweep (single `docs:` commit)

Update docs to match reality; where Phase 1 changes behavior, describe the new behavior:

- [ ] §4 "shared … no Bun-specific runtime" vs `packages/shared/src/uuid.ts:37–43`
      (`Bun.randomUUIDv7`) — either document the server-only generator module or fix in P1 (1.9).
- [ ] §6 Qdrant sync described as replay/orphan-delete vs full delete-all + re-upsert
      (`packages/vectordb/src/qdrant-index.ts:326–369`) — align doc with implementation.
- [ ] §6 "filters applied client-side after 8× overfetch on the fallback path" — restate so it
      is true for every backend path (after 1.1).
- [ ] §7 EXTRACT_MODEL config table vs `apps/server/src/extract.ts:147–159` behavior.
- [ ] §4 layout line `search/ FTS5 + RRF` → "RRF fusion + KNN fallback" (FTS5 SQL lives in db).
- [ ] §7 Stage 4/6 retraction semantics (after 1.3).
- [ ] `packages/core/src/services/review.ts:7–9` comment says classifier creates vocabulary —
      wrong (MODEL.md principle 5); fix comment in 1.3's commit.
- [ ] MODEL.md §5 migration sentinel wording vs `resolveActiveDataset` behavior.
- [ ] DESIGN.md: document the Share page treatment (exists in sidebar + code, missing from doc).

## Phase 2 — P1 (architecture / robustness)

- [ ] 2.1 Cross-dataset assignment guard: compare `tag.datasetId` vs `bookmark.datasetId` in
      `packages/core/src/services/bookmarks.ts:145–155`; same for `categoryId` on create/update
      and `updateTag` (`packages/db/src/queries/tags.ts:101–122`); UUID shape → 400 not 500
      (`apps/server/src/app.ts:254–257`). Test: cross-dataset assign rejected at service layer.
- [ ] 2.2 Review queue hygiene: `packages/db/src/queries/review.ts:21–50` — exclude
      (bookmark, tag) pairs already assigned (`NOT EXISTS`), dedupe to latest run per pair.
- [ ] 2.3 `packages/shared` Bun split: pure codec (`uuid-codec.ts`) vs server generator;
      web must never pull `Bun.*`.
- [ ] 2.4 `EXTRACT_MODEL` threading: through `ServerConfig`/`env.ts`, passed into the Ollama
      extraction client (`apps/server/src/extract.ts:90–108,147–159`).
- [ ] 2.5 Web keyboard/touch: explicit `Enter` open + confirmed delete in list keyboard nav
      (`BookmarkList.tsx:365–404`); hover-only card actions reachable on touch (`:239–267`);
      global Escape closes open sheets (`App.tsx:325–333`); guard `/`+`c` shortcuts against
      open popups/selects (`App.tsx:295–337`); remove label-overriding `aria-label`
      (`Topbar.tsx:81`); `TagPill` instead of `Badge` in `ClassifierSuggestions.tsx:86`.

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
