# Browser e2e suite

Function-focused end-to-end tests for the full stack (Hono API + React web) driven through
**Playwriter** in a disposable headless Chrome. Navigation and behavior only — no visual/aesthetic
assertions. See `docs/ARCHITECTURE.md` §5 ("Browser e2e suite") for the design rationale.

## Run

```bash
bun run test:e2e                 # full suite
bun run test:e2e --only 02       # scenarios whose filename contains "02"
bun run test:e2e --list          # list scenarios
```

Prerequisites (one-time): `bun run browser:install` (Chrome for Testing) and the globally
installed `playwriter` CLI (`~/.bun/bin/playwriter` — see AGENTS.md). Ports 3000 and 5173 must be
free; the runner fails fast with a clear message otherwise.

## What happens on each run

1. Fresh scratch `DATA_DIR` (mktemp) seeded with the canonical **octocat** fixture — the seed also
   marks setup complete, so the first-run wizard never gates the UI.
2. Server (`:3000`) and web dev server (`:5173`) spawn as children; the runner waits on
   `/api/health` + web readiness.
3. A headless Playwriter session drives the UI; each scenario runs via `playwriter -f`.
4. Teardown: session deleted, process groups killed, scratch dir removed. Nothing touches `data/`.

Root `.env` and provider env vars are **not** forwarded: the suite always exercises the degraded,
sidecar-free contract (keyword-only search, deterministic import parser, no classifier/chat).

## Scenarios

| File | Covers |
| ---- | ------ |
| `01-nav.mjs` | Sidebar navigation to all routes, direct hash navigation, browser back, Cmd/Ctrl+K palette, Cmd/Ctrl+B sidebar, `/` search focus, mobile off-canvas nav |
| `02-library-search.mjs` | Keyword search, empty state, clear filters, category/tag filters, pagination, sort direction, detail sheet |
| `03-bookmarks-crud.mjs` | Add / edit / tag assign / delete-cancel / delete-confirm via sheets + confirm dialog |
| `04-vocabulary.mjs` | Tag create/rename/deprecate/reactivate/delete, category create/delete |
| `05-import.mjs` | Markdown paste → extract → preview rows → row toggle → commit counts → library verification → re-import idempotency |
| `06-export.mjs` | Format selection, filters, match count, JSON + Netscape HTML downloads verified by content |
| `07-profile.mjs` | Layout/theme/default-search-mode persistence, identity rename |

Out of scope (needs sidecars): semantic/hybrid search results, classifier auto-tagging, LLM chat.

## Conventions (see also helpers)

- Scenarios are plain ESM `.mjs` loaded by the playwriter sandbox with cache-busted dynamic
  imports (`?v=${Date.now()}`) — the relay daemon caches imported modules across executions.
- `beginScenario('<filename-minus-.mjs>')` must match the filename: the runner reads results from
  `/tmp/al-yo-bo-e2e-results/<name>.jsonl` (playwriter's CLI only tails console output, so a file
  is the reliable channel).
- Assertions go in `check(...)` blocks — a failure is recorded and later checks still run.
- Every scenario ends with a "no uncaught page errors" check via `attachErrorCollector`.
- The DB is seeded once per suite run and scenarios share it: never assert exact global counts,
  and use unique (`Date.now()`-suffixed) names for anything you create.
- `openApp` forces a fresh document load: hash-only navigation is same-document and would leak
  React filter/selection state between scenarios.

## Debugging a failing scenario

```bash
bun run test:e2e --only 02       # failing check names + messages print after the summary
bun run browser:start            # headed browser with the project profile for manual inspection
```

Scenario console output is mirrored live; per-check results land in the JSONL file even when a
scenario dies mid-run.
