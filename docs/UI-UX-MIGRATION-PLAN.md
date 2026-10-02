# al-yo-bo — UI/UX Migration Plan

> Plan approved via `annotate_plan` on 2026-10-02; executed immediately after.
> This document is the source of truth for what was committed and what remains.
> Read alongside `docs/UI-UX-DIRECTION.md` (Phase 6 design direction) and
> `docs/DESIGN.md` (token / substrate contract).

## Brainstorm decisions (locked)

1. Add the **shadcn MCP server** to al-yo-bo now.
2. Install **Lombiq/Tailwind-Agent-Skills** in the project.
3. Migrate **shadcn from radix to base-ui**.
4. Use **coss.com/ui alongside** shadcn.
5. Use **beui.dev alongside** shadcn — **and replace assistant-ui's chat surface with beui primitives**.

User-stated preferences baked into the plan:

- DESIGN.md is a **working document** — actively updated during UI/UX work.
- Phase 1 web sanity-check for `assistant-ui` / `base-ui` compat is intentionally skipped
  ("I prefer this to the cost of investigation").
- Migration scope is **partial**: keep assistant-ui's internal Radix usage as-is,
  migrate the other 15+ shadcn wrappers. Once Phase 5 drops assistant-ui, the
  partial scope naturally becomes a wholesale migration.

## Phases

### Phase 0 — Foundational setup (gating)

- **0.1** `bunx --bun shadcn@latest mcp init --client opencode` →
  `opencode.json` `mcp.shadcn` block.
- **0.2** `bunx --bun skills add shadcn/ui --agent opencode -y` →
  `.agents/skills/shadcn/` and `.agents/skills/migrate-radix-to-base/`.
- **0.3** `bunx --bun skills add Lombiq/Tailwind-Agent-Skills --agent opencode -y`
  then `python3 .agents/skills/tailwind-4-docs/scripts/sync_tailwind_docs.py
  --accept-docs-license`.

**Status**: ✅ complete (3 commits: 15eb183, cb22943, 747e833).

### Phase 1 — Decide base-ui migration scope (lightweight)

- Default: **partial**. Migrate 15+ non-assistant-ui radix-backed components to
  base-ui; keep assistant-ui's internal Radix usage as-is.
- 5-min web/Gitry search for known base-ui + assistant-ui issues — skipped per
  user's "I prefer this to the cost of investigation".

**Status**: ✅ complete (no commit; assumption documented).

### Phase 2 — Configure registries

- `apps/web/components.json` `registries`:

  ```json
  "@coss": "https://coss.com/ui/r/{name}.json",
  "@beui": "https://beui.dev/r/{name}.json"
  ```

- Smoke test: `shadcn view @coss/button` and `shadcn view @beui/message-bubble`.

**Status**: ✅ complete (commit d013652).

### Phase 3 — Per-component base-ui migration

- Flip `apps/web/components.json` `style: "radix-nova"` → `"style": "base-nova"`.
- Use the official `migrate-radix-to-base` skill for the per-component flow.
- **Never** `shadcn add --all --overwrite` — per-component commits only.
- Order: primitives first, composites later.
- CLI auto-transforms: `asChild` → `render`; `onOpenChange` → `onChange`.
- Manual review: data-attribute CSS selectors, `Field` forms,
  nested `asChild`/`render`.
- Add missing DESIGN.md canonicals: `command`, `popover` (base-ui ports).

**Status**: ✅ complete (10 commits: 8916a5a, aa71346, 265cd0a, 844cf02, ffeb0d1,
95f83ab, 243b344, c8b69d1, cfaf566, 239c482, 3b8420a, 8000e99, 01dab0a, 416dde3 —
plus per-component migration reports in `.migration/`).

### Phase 4 — Selective coss.com/ui adoption

- Adopt coss components where they materially improve the current wrapper
  (production-tuned base-ui primitives, not stock shadcn).
- Audit first; commit per adopted component.
- Pulled from the post-Phase-3 audit (see "Audit" below).

**Status**: 🟡 partial (7 of 9 picks committed). Pending: `@coss/field`,
`@coss/table`. Adopted so far: `@coss/empty`, `@coss/sheet` (pulled
button/scroll-area/spinner upgrade), `@coss/alert-dialog` (consolidated
`Action`/`Cancel` → `Close`), `@coss/command` (replaced dead cmdk wrapper;
`cmdk@^1.1.1` dropped), `@coss/select`, `@coss/dialog`, `@coss/card`
(resurrected dead wrapper; `BookmarkCard` refactor still pending).

### Phase 5 — Replace assistant-ui chat surface with beui.dev

- **Scope**: replace, not layer.
- Install beui primitives: `message-bubble`, `prompt-input`,
  `streaming-response`, `message-scroller`, `agent-activity` (+ others as
  needed).
- Refactor `apps/web/src/components/ChatPanel.tsx` to use beui instead of
  assistant-ui.
- After refactor: decide whether to drop `@assistant-ui/react` + `react-markdown`
  + `ai` deps (likely yes) or keep them for any non-chat use.
- Adds `motion` dep.

**Status**: ⏳ pending.

### Phase 6 — UI/UX direction + DESIGN.md update

- Propose concrete pages / components using the new stack.
- **Update DESIGN.md** to reflect the new system (beui.dev chat, base-ui
  primitives, coss.com/ui additions, motion defaults). DESIGN.md is a
  working document, not a constraint — it evolves with the implementation.
- Wire 150–200 ms ease-out motion + `prefers-reduced-motion`.

**Status**: ✅ complete for the doc side (commit 39ac863). The "concrete pages"
follow-ups are the 7 next actions in `docs/UI-UX-DIRECTION.md`.

### Final cleanup — drop `radix-ui` dep after Phase 5

- `@radix-ui/*` is gone from apps/web source code today (Phase 3 cleared it);
  the dep stays because `@assistant-ui/react` transitively pulls it.
- After Phase 5, `bun remove radix-ui` from `apps/web`; verify `bun run typecheck`
  + `bun run build`.

**Status**: ⏳ pending (gated on Phase 5).

## Verification gates (after each phase)

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun test`
- Browser smoke for visuals: `bun run browser:start` (Playwriter per
  DESIGN.md / AGENTS.md).

## Risks & open questions (revised)

1. **assistant-ui / Base UI compat** — low priority; default partial; likely
   moot once Phase 5 drops assistant-ui.
2. **Sonner → Base UI toast** — coss.com/ui drops Sonner; intentional or keep?
3. **`cn` package compat with Base UI** — likely fine, verified after the first
   migration.
4. **`shadcn/tailwind.css` runtime dep** — base-nova should still use it; verify
   after style flip.
5. **Per-component commit cadence** — one commit per migrated component.
6. **Lombiq `tailwind-4-docs` sync** — needs Python 3.8+ on the dev machine.
7. **beui.dev + assistant-ui coexistence** — if both end up installed during
   refactor, mind bundle size; drop assistant-ui as soon as the last non-chat
   usage is removed.

## Execution order

- Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 (sequential).
- Phase 1 minimal, can overlap with 3 prep.
- Phase 4 / 5 can run in parallel after Phase 3 if scope allows.

## Audit summary (drives Phase 4 picks)

Source: `apps/web` recon via the `explorer` subagent after Phase 3 completed.
Captured in `docs/UI-UX-DIRECTION.md`.

**App state**:
- Single SPA, minimal hash router, two routes (`library` ↔ `import`).
- `App.tsx` is a 572-line monolith owning 6 react-query queries, 7 overlay
  flags, pagination, debounced search, global keyboard shortcuts
  (`/` focus search, `c` toggle chat, `Esc` close).
- Forms: zero `<form>`, zero `react-hook-form` / `zod`. Every form is per-field
  `useState` + `useCallback` submit. AddBookmark, BookmarkDetail, VocabDialog
  (with **3 repeated input+select+button clusters**), ImportPage/ImportRow
  (6 editable fields/row), Topbar search.
- Lists: hand-rolled card list/grid; server-side offset pagination 20/page;
  no virtualization. BookmarkList, ImportPage rows, ClassifierSuggestions.
- Tables: zero. (DESIGN.md promises one; `ui/table.tsx` doesn't exist.)
- assistant-ui surface: `ChatPanel.tsx` renders `Thread`, `Composer`,
  `ActionBar`, etc.

**Dead installed primitives (zero imports)**: `command` (cmdk, now replaced),
`popover`, `collapsible`, `card` (now revived), `input-group`.

**Phase 4 picks** (audit-ranked):

| Pick | Status | Notes |
|---|---|---|
| `@coss/empty` | ✅ | rich `EmptyMedia` with `variant: default|icon` |
| `@coss/sheet` (+ button + scroll-area + spinner) | ✅ | richer cva button family, `loading` prop |
| `@coss/alert-dialog` | ✅ | `Action`/`Cancel` → single `Close` + `buttonVariants` |
| `@coss/command` + drop cmdk | ✅ | replaces dead cmdk wrapper |
| `@coss/select` | ✅ | `SelectButton`, `SelectGroup` extras |
| `@coss/dialog` | ✅ | richer content sizing |
| `@coss/card` | ✅ | wrapper only — `BookmarkCard` refactor pending |
| `@coss/field` | ⏳ | greenfield: refactor 5 forms |
| `@coss/table` | ⏳ | DESIGN.md canonical, missing; fits ImportPage |

## Status snapshot

- 26 commits on `main` since the plan was approved.
- All apps/web workspaces typecheck clean.
- Lint clean (pre-existing warnings + 2 new `react-perf(jsx-no-jsx-as-prop)` hints
  on `render={<X/>}` polymorphic usage — acceptable; memoize later if it shows
  in profiling).
- 8 migration reports in `.migration/`.
- `cmdk` dep removed from `apps/web/package.json`.
- `@radix-ui/*` deps gone from source; the unified `radix-ui@^1.6.7` stays
  transitively until Phase 5.

## Outstanding refactors (surfaced for follow-up)

1. **`@coss/field`** + refactor `AddBookmarkDialog`, `BookmarkDetailDialog`,
   `VocabDialog` (and 3-cluster triplication) to use it.
2. **`@coss/table`** + rewrite `ImportPage` editable rows on table semantics.
3. **`BookmarkCard` → coss Card anatomy** in `BookmarkList.tsx:143-203`.
4. **List keyboard navigation** for `BookmarkList.tsx` (roving tabindex,
   `role="listbox"`, `↑`/`↓`/`Enter`/`Delete`).
5. **Topbar redesign** for hierarchy (consolidated Create + account menus;
   search-hero layout).
6. **Library entrance + pagination crossfade** motion.
7. **Tag assignment combobox** in `BookmarkDetailDialog.tsx` (replaces the
   `<Select>`-as-action-trigger anti-pattern).
8. **Command palette wiring** (`Cmd/Ctrl+K` → coss command modal — search +
   category/tag jumps + recent queries).
9. **Phase 5** beui chat replacement (drop `@assistant-ui/react` + the
   now-unused `radix-ui` transitive dep).
10. **Final cleanup** `bun remove radix-ui`.

## Source files referenced

- `docs/DESIGN.md` — refreshed design system contract (base-ui + coss/beui).
- `docs/UI-UX-DIRECTION.md` — companion doc with audit + direction + next actions.
- `docs/ARCHITECTURE.md` — system architecture (precedence: ARCHITECTURE > MODEL >
  DESIGN > README).
- `apps/web/components.json` — `base-nova` style + `@coss` / `@beui` registries.
- `apps/web/src/components/ui/*` — 23 base-ui + coss wrappers (was 22 stock).
- `.migration/*.md` — per-component migration reports (8 files).