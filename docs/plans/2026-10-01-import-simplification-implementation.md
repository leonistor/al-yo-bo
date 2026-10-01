# Import simplification — implementation plan

> **Status: IMPLEMENTED** (2026-10-01). All phases 0–7 are shipped and verified end-to-end in a
> headful browser (paste → LLM extract → edit → commit → screenshot render). `ARCHITECTURE.md`,
> `MODEL.md`, `README.md`, and `DESIGN.md` are reconciled. Landing commits: `71f25dc` (phase 3),
> `660c84a` (phase 4), `1d1879c` (phase 4 commit contract), `7a937db` (phase 5), `61623f7`
> (phase 7); plus e2e fixes in `34f50ad` (project `bookmark.image` on reads; Vite `/data` proxy).
> The dead seed links that clogged the enrichment queue were pruned from both seed fixtures
> (`leo` 217→212, `grimoire` 26→23) and the live dev DB.

> Picks up the [design doc](./2026-10-01-import-simplification-design.md) and resolves the five
> open questions. Ordered by dependency. Each section names files, gives a sketch, and lists
> acceptance criteria. Reviewed against: [ARCHITECTURE.md](../ARCHITECTURE.md), [MODEL.md](../MODEL.md),
> packages/db, packages/core, packages/importer, apps/server, apps/web.

## Resolved decisions

| # | Question | Decision |
|---|---|---|
| 1 | Screenshot mechanism | **`Bun.WebView`** — zero-install WebKit on macOS; pinned `chrome-headless-shell` on Linux (mirror `scripts/qdrant/install.sh`). Synchronous at import, timeout-bounded, graceful fallback to `og:image` → placeholder. |
| 2 | LLM extraction provider | **AI SDK v7 `generateText` + `Output.object({ schema })`** with Zod. OpenRouter primary (`@ai-sdk/openai-compatible`), Ollama local (`ollama-ai-provider-v2`), deterministic parser fallback. New dep: `@ai-sdk/openai-compatible`. Env: `EXTRACT_MODEL` (default `deepseek/deepseek-v4.1-flash`); reuse `OPENROUTER_API_KEY`/`OLLAMA_URL`/`OLLAMA_CHAT_MODEL`. |
| 3 | Dedup merge policy | **Reuse `upsertBookmarkByUrl`** (packages/db/src/queries/bookmarks.ts:209). New non-null fields win; existing `scraped_at`/`content_hash`/`embedding`/`id` preserved; tags union'd via `assignTag` (already idempotent). Show "X new, Y updated" toast. No bookmark IDs change. |
| 4 | Vocabulary auto-creation | **Auto-create as active** on import (no proposal state). Drop `status` column and `merged_into_id` from `sections`/`categories`/`tags`. VocabDialog keeps rename/delete. Classifier stops auto-creating tags — only votes on existing ones; unmatched labels are recorded as evidence and surfaced as below-threshold candidates (no `proposed` lifecycle). Review queue shrinks to **below-threshold candidates only**. |
| 5 | Summary timing | **LLM-extracted note = description at import time.** No separate `summarize` job in MVP. Page content flows through scrape → `bookmarks.content` → embedding as today. Track `metadata.description_source = 'extraction' \| 'user'` so a future `summarize` job can know whether to overwrite. |

## Phases

Each phase ends with `bun run typecheck && bun run lint && bun test` green.

---

### Phase 0 — prep: shared types + bookmarks.metadata shape

**Why first:** every later phase touches the same types; lock them down so phases can land in parallel.

**Files:**
- `packages/shared/src/types.ts` — drop `ImportedBookmark.subsection` (it was always a UI-side alias for `category` after resolution); rename to a single `category` field. Keep `priority`/`tags`. Add `image?: { ogImageUrl: string | null; screenshotPath: string | null }` to a new `BookmarkDetail`-flavored type or to `BookmarkWithTags`.
- `packages/shared/src/types.ts` — drop `VocabularyProposal`, `StagedBatch`, `ImportReport.staged | batchId | proposals`.
- `packages/shared/src/types.ts` — narrow `TagStatus` to `'active' | 'deprecated'`; same for `Section['status']`/`Category['status']` (drop `'proposed' | 'rejected'`).
- `packages/shared/src/dto.ts` (if it re-exports) — propagate removals.

**Acceptance:**
- `rg "VocabularyProposal|StagedBatch|subsection|\.staged|\.batchId|proposals" packages/` returns only the references we control in later phases.
- TypeScript green.

---

### Phase 1 — data model: drop staging + simplify vocabulary

**Why next:** phases 2+ depend on a vocabulary table without `status`/`merged_into_id`.

**Files:**
- `packages/db/migrations/` — new migration `00X_simplify_vocabulary.sql`:
  - `sections`: drop `status` CHECK; drop `merged_into_id` column.
  - `categories`: drop `status` CHECK; drop `merged_into_id` column.
  - `tags`: drop `status` CHECK; drop `merged_into_id` column.
  - `import_batches`: drop table (and its index). Cascades check: nothing else references it.
  - `bookmarks.metadata`: no schema change (still JSON TEXT), but document the new shape in a comment in the migration.
- `packages/db/src/queries/{sections,categories,tags}.ts` — remove all `status`/`merged_into_id` parameters and fields from create/update/list helpers.
- `packages/db/src/queries/vocabulary.ts` (if present) — same.
- `packages/db/src/row-mapping.ts` — drop `status`/`mergedIntoId` mapping.
- `packages/db/src/seed.ts` — remove any `'proposed'` rows in fixtures; assert no `merged_into_id` references.
- `packages/db/seeds/datasets/leo` (and any regenerated) — same.
- `packages/core/src/services/vocabulary.ts` — `setStatus`/`acceptProposal`/`rejectProposal`/`renameProposal`/`mergeProposal` removed; `createCategory/Section/Tag` no longer take `status`.
- `packages/core/src/services/import.ts` — see phase 2.

**Acceptance:**
- `bun run typecheck` green after each file edit.
- `bun test` green; `core/tests/vocabulary.test.ts` updated to drop proposed-state cases.
- `bun run db:seed leo` and `bun run db:clear leo --yes` both work; `bun run db:seed grimoire` likewise.

---

### Phase 2 — importer: LLM extraction + auto-create vocabulary + direct commit

**Why after phase 1:** the import path needs `createCategory/Section/Tag` without a status arg.

**Files:**
- `packages/importer/src/parse.ts` — **keep as-is** for the offline fallback (tested, deterministic). Mark the export with a JSDoc "fallback path used when the LLM is unavailable".
- `packages/importer/src/extract.ts` (new) — transport-neutral:
  - `extractedBookmarkSchema = z.object({ url, title, description, category, tags, priority })` mirroring `ImportedBookmark`.
  - `extractionSchema = z.object({ bookmarks: z.array(extractedBookmarkSchema) })`.
  - `extractionPrompt(text)` — prompt with the markdown collection-file shape as a *suggestion*, plus "never invent URLs / tags / categories" guard.
  - `interface ExtractionClient { extract(text: string): Promise<ImportedBookmark[]> }`.
  - `function fallbackExtraction(text): ImportedBookmark[]` wrapping `parseCollection`.
- `packages/importer/src/ingest.ts` — rewrite `resolveVocabulary` to **auto-create missing vocabulary as active** (no proposals):
  - For each unique `(section, category, tagName)`: lookup active → if missing, `createSection/Category/Tag` with no status.
  - `VocabularyResolution.proposals` → either empty array (always) or removed entirely.
  - `ingestBookmarks` keeps current behavior (upsert by URL, assign tags via `assignTag`).
- `packages/importer/src/index.ts` — re-export `extract.ts`.
- `packages/importer/tests/extract.test.ts` (new) — Zod schema fixtures; prompt shape snapshot (golden file); fallback equivalence (markdown in → parseCollection output matches LLM-extracted output for the same input).
- `packages/importer/tests/ingest.test.ts` — update to assert auto-create of vocabulary (no proposals).
- `packages/core/src/services/import.ts` — rewrite to direct-commit:
  - `preview(markdown)` → returns LLM-extracted bookmarks (with config-gated fallback to parser). Adds `provider: 'llm' | 'fallback'` and `warnings?: string[]` (e.g. "fell back to deterministic parser").
  - `import(markdown, datasetId, options)` → resolves vocabulary (auto-create), ingests, enqueues enrichment. No staging, no proposals, no batchId.
  - `commit(batchId)` / `discard(batchId)` / `listStaged(datasetId)` / `StagedBatch` — removed.
- `packages/core/tests/import.test.ts` — rewrite assertions: no staging, auto-created vocab is active immediately, dedup merges.

**Acceptance:**
- `bun test packages/importer packages/core` green.
- LLM extraction returns Zod-validated `ImportedBookmark[]` for the `docs/examples-mds/*` fixtures (golden snapshot).
- Deterministic parser still produces identical output for the same fixtures.

---

### Phase 3 — server: routes + LLM adapter + screenshot job

**Why after phase 2:** routes call into the new import service.

**Files:**
- `apps/server/src/env.ts` — add an `extract` block mirroring `chat`:
  ```ts
  extract: {
    openrouter: { apiKey: string | null; model: string; baseUrl: string };
    ollama: { baseUrl: string; model: string | null };
  }
  ```
  Resolve `model`: prefer `EXTRACT_MODEL` env, else `OPENROUTER_API_KEY` set → `deepseek/deepseek-v4.1-flash`, else `OLLAMA_CHAT_MODEL` set → `OLLAMA_CHAT_MODEL`, else no provider.
- `apps/server/src/extract.ts` (new) — adapters mirroring `chat.ts`:
  - `openRouterExtractionClient(config)` using `@ai-sdk/openai-compatible`.
  - `ollamaExtractionClient(config)` using `ollama-ai-provider-v2`.
  - `extractWithFallback(client | null, text)` — try LLM, catch `NoObjectGeneratedError` / `APICallError` / timeout → `fallbackExtraction`.
- `apps/server/src/screenshot.ts` (new) — adapter mirroring `scrape.ts`:
  - `interface ScreenshotClient { capture(url: string): Promise<Buffer | null> }`.
  - `bunWebViewScreenshotClient({ width, height, settleMs, timeoutMs })` — uses `await using view = new Bun.WebView({ width, height })` + `view.navigate` + `Bun.sleep(settleMs)` + `view.screenshot({ format: 'jpeg', quality: 80, encoding: 'buffer' })`. Throws `ScreenshotError` on failure or timeout.
  - `ogImageScreenshotClient({ fetchImpl, scrapeImpl })` — fallback path: parse `<meta property="og:image">` from the already-fetched HTML; download the image bytes via `fetch`; return. Returns `null` when no og:image. Reuses the existing `fetchPageHtml` from `scrape.ts`.
  - `compositeScreenshotClient({ primary, fallback })` — try `primary.capture(url)`; on error log `console.warn` and try `fallback.capture(url)`; on both failing return `null`.
- `packages/core/src/enrichment/jobs.ts` — extend `JobType` union with `'screenshot'`; add handler:
  ```ts
  screenshot: async (id) => { /* fetch existing scrape content if any, else fetch page HTML,
    run compositeScreenshotClient, write to data/screenshots/{uuid}.jpg, store path in metadata.image.screenshotPath */ }
  ```
  Reconcile: `listBookmarkIdsMissingScreenshot(db)` — bookmarks whose `metadata` has no `image.screenshotPath` AND `metadata.image.ogImageUrl IS NULL AND status = 'active'`. Called from `reconcileEnrichment`.
- `apps/server/src/index.ts` — wire `screenshot` client into `core.createCore` (new port in `core`).
- `packages/core/src/create-core.ts` — add `screenshot: ScreenshotClient | null` to deps; pass to job queue. Add `extract: ExtractionClient | null` to deps; pass to `createImportService`.
- `packages/core/src/services/import.ts` — import-side enrichment trigger: after `ingestBookmarks`, enqueue `scrape`, `embed`, **and `screenshot`** for each addedId. The screenshot job runs independently of scrape (uses its own fetch).
- `apps/server/src/app.ts` — route changes:
  - Replace `/api/import/preview` and `/api/import` to call the new service.
  - Drop `/api/import/batches/:id/{commit,discard}` and `/api/import/staged`.
  - Drop `/api/review/vocabulary/:kind/:id/{accept,reject,rename,merge}`.
  - Drop `/api/sections/:id/status`, `/api/categories/:id/status`, `/api/tags/:id/status` (status is gone). Keep `/api/sections|.../P` routes that operate without status.
  - Update `/api/health` to include `extract.available` and `screenshot.available`.
- `apps/server/src/health.ts` (or wherever health lives) — add extract/screenshot presence to `available`.
- `package.json` (root) — add `@ai-sdk/openai-compatible` to deps.

**Acceptance:**
- `bun run typecheck` green; `bun test` green (server tests too).
- `bun run dev` starts; `curl localhost:3000/api/health` shows the new `extract`/`screenshot` fields.
- Manual: pasting `docs/examples-mds/dev.md` into the new Import page extracts ≥ N bookmarks with non-empty titles.

---

### Phase 4 — web: Import page with vertical split

**Why after phase 3:** the page calls the new routes.

**Files:**
- `apps/web/src/lib/router.ts` (new) — minimal hash-based or in-memory router with two routes: `'library'` (default, current `View`) and `'import'`. No new dep — `App.tsx` switches based on `window.location.hash` and a `hashchange` listener; or use a tiny `useState<Route>` + programmatic `history.pushState`. Mirror `setView` semantics.
- `apps/web/src/components/ImportPage.tsx` (new) — vertical split layout:
  - **Left pane** (resizable or 50%): source input.
    - Tabs: "Paste text" (textarea) | "Upload file" (`<input type="file">`).
    - Top bar: a primary "Extract" button (disabled when text empty or in-flight), a small inline status line ("LLM via openrouter/deepseek-v4.1-flash" or "fallback: deterministic parser").
  - **Right pane**: extracted bookmark list.
    - Empty state when no extraction yet ("Paste, then Extract").
    - While extracting: skeleton rows + spinner.
    - When extracted: editable rows (inline `title`, `description`, `tags`, `category`, `priority`; remove button per row; checkbox to "include"). Header shows count + dedup hint ("X new, Y already exist").
  - Bottom-right sticky bar: "Cancel" (clears state) | "Import N bookmarks" (primary).
- `apps/web/src/components/ImportRow.tsx` (new) — single editable row (separated so the list can use `useMemo`/`useTransition`).
- `apps/web/src/components/ImportDialog.tsx` — **delete** (replaced by the page).
- `apps/web/src/App.tsx`:
  - Replace `importOpen` state with `route === 'import'`.
  - Remove `onStaged` flow; `ImportDialog` import is gone.
  - Topbar: rename "Import" button to trigger the new route.
  - `<Sidebar />` review section: drop "Proposed vocabulary" / "Proposed tags" sections; keep only "Below-threshold candidates" (renamed to "Classifier suggestions"). Review queue entry point can stay.
- `apps/web/src/components/ReviewQueue.tsx` — remove `batches`, `proposed`, `onApprove`, `onReject`, `onAcceptProposal`, `onRejectProposal`, `onCommitBatch`, `onDiscardBatch` props. Rename to `ClassifierSuggestions.tsx` and keep only the below-threshold list.
- `apps/web/src/components/Topbar.tsx` — "Import" now navigates to `/#/import`.
- `apps/web/src/lib/client.ts`:
  - Drop `commitImportBatch`, `discardImportBatch`, `fetchStagedBatches`, `acceptProposal`, `rejectProposal`.
  - Add `extractImport(text): Promise<{ bookmarks: ImportedBookmark[]; provider: 'llm' | 'fallback'; warnings?: string[] }>`.
  - Add `commitImport(text, edited: ImportedBookmark[], options?): Promise<ImportReport>` (server resolves vocabulary again with auto-create and dedups by URL — the client only ships what the user confirmed).
- `apps/web/src/lib/import.ts` — delete (logic moves to page + client).

**Acceptance:**
- Loading `/#/import` shows the page; Topbar "Import" button navigates to it.
- Pasting a 50-line markdown collection, clicking Extract, shows the editable list within ~3s (LLM) or ~200ms (fallback).
- Editing a row updates state without re-rendering the whole list (React DevTools check).
- Removing a row excludes it from the commit count.
- Clicking "Import N bookmarks" redirects back to `/#/library` and shows a toast with `added`/`updated`.
- No reference to `ImportDialog` / `ReviewQueue` / `proposed` / `batches` survives in `apps/web/src`.

---

### Phase 5 — screenshot artifacts + BookmarkDetail rendering

**Why after phase 4:** the page is the producer; this phase is the consumer.

**Files:**
- `apps/server/src/index.ts` (or `apps/server/src/static.ts`) — add `GET /data/screenshots/:filename` route guard:
  - Validates filename is `<uuid>.jpg` (regex).
  - Serves from `data/screenshots/` via `serveStatic` or `Bun.file()`.
  - No listing. Same posture as `data/qdrant/` (gitignored, never backed up).
- `.gitignore` — add `data/screenshots/`.
- `apps/web/src/components/BookmarkDetailDialog.tsx` — render the screenshot in the header:
  - If `metadata.image.screenshotPath` → `<img src={\`/data/screenshots/${filename}\`} />`.
  - Else if `metadata.image.ogImageUrl` → `<img src={ogImageUrl} crossOrigin="anonymous" />`.
  - Else → placeholder (`<Card>` with the bookmark favicon / a gray block).
- `apps/web/src/components/BookmarkList.tsx` — same fallback chain on the grid/list card thumbnails.
- `packages/db/src/queries/bookmarks.ts` — `BookmarkWithTags` type carries `image?: { ogImageUrl: string | null; screenshotPath: string | null }` parsed from `metadata`. Add a `parseBookmarkImage(metadata)` helper to keep the parsing in one place.
- `docs/ARCHITECTURE.md` §8 — add `screenshot` to the job table; document the `data/screenshots/` path and the graceful degradation ladder.

**Acceptance:**
- Imported bookmarks with a scrapeable URL have a screenshot visible within ~5s of import.
- A page with no og:image still gets a placeholder, never a broken image.
- A failed screenshot does not invalidate the bookmark or fail the import (reconcile retries on next start).

---

### Phase 6 — docs

**Why last:** the docs describe the system we now have, not the system we're building.

**Files:**
- `docs/ARCHITECTURE.md`:
  - §2 stack: add `Bun.WebView` row (serving screenshots) and `@ai-sdk/openai-compatible` (extraction).
  - §7 Stage 1 (Ingest): replace the two-phase import prose with the direct-commit + auto-create flow.
  - §7 Stage 5 (Review): rewrite to "below-threshold classifier suggestions only".
  - §8 jobs: add `screenshot` row; document `data/screenshots/`; add `EXTRACT_MODEL` config.
  - §10 failures: extend table with image-capture failure modes.
  - §11 revisit: add the `Bun.WebView` experimental-API revisit trigger.
- `docs/MODEL.md`:
  - Drop principle 3 lifecycle paragraphs that reference `proposed`/`rejected`.
  - Drop `import_batches` table section.
  - Drop `status` CHECK + `merged_into_id` from `sections`/`categories`/`tags` SQL.
  - Update deletion semantics.
- `docs/DESIGN.md` — update Import page section (DESIGN tracks components/pages; this is a major one).
- `docs/plans/2026-10-01-import-simplification-design.md` — mark **status: implemented**, link to this plan.

**Acceptance:**
- A fresh agent reading ARCHITECTURE + MODEL + DESIGN understands the import flow, vocabulary lifecycle, and job shape without backreferences to the old design.
- All `rg "import_batches|VocabularyProposal|proposed|merged_into_id"` over `docs/` returns 0.

---

### Phase 7 — test fixtures + CI sanity

**Files:**
- `packages/importer/tests/fixtures/extraction/` (new) — 3–4 markdown fixtures from `docs/examples-mds/`. Golden JSON of expected extraction output (parser fallback).
- `packages/core/tests/import.test.ts` — new test cases:
  - Auto-create of section + category + tag on commit.
  - Re-import merges by URL (no new bookmark id).
  - Review flow removal (no staging, no proposals).
- `packages/core/tests/jobs.test.ts` — add `screenshot` job case.
- `scripts/chrome/install.sh` (new, mirror `scripts/qdrant/install.sh`) — downloads pinned `chrome-headless-shell` into `.tools/chrome/`.

**Acceptance:**
- `bun test` green.
- `bun run qdrant:install && bun run chrome:install && bun run dev` runs all three sidecars.
- README's "Development" section mentions `bun run chrome:install` and `EXTRACT_MODEL`.

---

## Sequencing & parallelism

- **Phase 0 → 1 → 2 → 3 → 4 → 5** is the linear dependency backbone.
- **Phase 6** can start once phases 2, 3, 4, 5 land (don't ship docs that contradict in-flight code).
- **Phase 7** is parallel-friendly but must finish before merge.
- Phases 2 (importer/core) and 5 (BookmarkList/Detail rendering) can be split between two fixer
  agents if desired — they touch disjoint files.

## Risks

- **`Bun.WebView` is experimental.** API may churn; pinning Bun version (`bunfig.toml`/`engines`) is mandatory. Mitigation: revisit trigger in ARCHITECTURE §11.
- **LLM extraction latency.** 100-bookmark paste at flash-tier hosted model = 30–90s. Mitigation: chunking + progress bar; MVP is single-user so the explicit "Extract" button already decouples UX.
- **Auto-create active vocabulary reverses an old invariant.** Mitigation: documented in MODEL.md; the VocabDialog's rename/delete stays the tidy-up tool.
- **Dropping `import_batches` is destructive.** Mitigation: existing staged batches are committed automatically by a one-time startup migration (`for each staged batch: parse `bookmarks` JSON, ingest with auto-create vocab, set status='committed'`); failed rows go to `metadata.unmigrated`.
- **Classifier stops auto-creating tags.** Users lose the "I have a tag suggestion" review path. Mitigation: classifier output that doesn't match an active tag is still logged as evidence (`classification_results`); tag suggestions surface as below-threshold candidates if the user opts in to creating them via VocabDialog first.

## Estimated effort

| Phase | Effort | Risk |
|---|---|---|
| 0 — types | XS | low |
| 1 — schema migration | M | medium (data migration for staged batches) |
| 2 — importer + service | L | medium (LLM adapter + tests) |
| 3 — server routes + jobs | M | medium (Bun.WebView API surface) |
| 4 — import page | L | low (UI work) |
| 5 — image rendering | S | low |
| 6 — docs | M | low |
| 7 — fixtures + scripts | S | low |

XS = <1h, S = 1–3h, M = half-day, L = 1–2 days.
