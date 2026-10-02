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
  `.opencode/opencode.jsonc` `mcp.shadcn` block. (Repo opencode config lives at
  `.opencode/opencode.jsonc` — references to a root `opencode.json` were wrong.)
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

**Status**: ✅ complete (14 commits: 8916a5a, aa71346, 265cd0a, 844cf02, ffeb0d1,
95f83ab, 243b344, c8b69d1, cfaf566, 239c482, 3b8420a, 8000e99, 01dab0a, 416dde3 —
plus per-component migration reports in `.migration/`).

### Phase 4 — Selective coss.com/ui adoption

- Adopt coss components where they materially improve the current wrapper
  (production-tuned base-ui primitives, not stock shadcn).
- Audit first; commit per adopted component.
- Pulled from the post-Phase-3 audit (see "Audit" below).

**Status**: ✅ complete (9 of 9 picks committed).
Adopted: `@coss/empty`, `@coss/sheet` (pulled button/scroll-area/spinner
upgrade), `@coss/alert-dialog` (consolidated `Action`/`Cancel` → `Close`),
`@coss/command` (replaced dead cmdk wrapper; `cmdk@^1.1.1` dropped),
`@coss/select`, `@coss/dialog`, `@coss/card` (resurrected dead wrapper;
`BookmarkCard` refactor still pending), `@coss/field` (+ `AddBookmarkDialog` /
`BookmarkDetailDialog` / `VocabDialog` refactored onto it; see
`.migration/coss-field.md`), `@coss/table` (`ImportPage` right pane rewritten
on table semantics; see `.migration/coss-table.md`).

### Phase 5 — Replace assistant-ui chat surface with beui.dev

- **Scope**: replace, not layer.
- **The chat surface is a stub** — `ChatPanel.tsx` (~83 lines) plus the
  disposable `components/assistant-ui/elements/*` scaffolding (9 files).
  Nothing there is worth preserving; this is a wholesale rebuild, not a
  refactor.
- Install beui primitives: `message-bubble`, `prompt-input`,
  `streaming-response`, `message-scroller`, `agent-activity` (+ others as
  needed).
- Rebuild `ChatPanel.tsx` on beui against the **unchanged server contract**:
  `POST /api/chat` (AI SDK UI message stream) + `searchBookmarks` tool-result
  cards.
- After rebuild: drop `@assistant-ui/react`, `@assistant-ui/ai-sdk`,
  `@assistant-ui/react-markdown`, `react-markdown`, and `ai` from apps/web —
  `ChatPanel` is their only consumer — and delete
  `components/assistant-ui/`.
- Adds `motion` dep.

**Status**: ✅ complete (commit 1c4dace). Execution notes:

- beui `message`, `prompt-input`, `streaming-response`, `agent-activity`
  installed from `@beui` (vendored under `components/agents/` +
  `components/motion/` plus a few `lib/` helpers); oxlint `ignorePatterns`
  carve-out added for the vendored dirs (upstream code style differs).
- `ChatPanel.tsx` rebuilt on `@ai-sdk/react` `useChat` + `DefaultChatTransport`
  against the unchanged `POST /api/chat` contract; `searchBookmarks` renders as
  an agent-activity row, then the library's `BookmarkCard` (now exported; its
  trash action dismisses a hit from the chat view only, never the library).
- **Dep deviation from the original bullets**: `ai` stays (transport,
  `UIMessage` types, `sendAutomaticallyWhen`); dropped `@assistant-ui/*` +
  `remark-gfm` (`react-markdown` was only transitive); added `@ai-sdk/react`
  and `motion`.
- Assistant text renders as plain text (no markdown renderer) — follow-up
  below if richer output is wanted.
- Smoke-tested live: the unconfigured/error path (calm inline alert,
  transcript and composer intact) and the full search → cards → streamed
  answer path with `llama3.2:latest`.

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
  the direct `radix-ui` dep stays until Phase 5 — after assistant-ui (its last
  transitive consumer) is dropped, `bun remove radix-ui` finishes the job.
- After Phase 5, `bun remove radix-ui` from `apps/web`; verify `bun run typecheck`
  + `bun run build`.

**Status**: ✅ complete (commit 5210a4c).

## Verification gates (after each phase)

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun test`
- Browser smoke for visuals: `bun run browser:start` (Playwriter per
  DESIGN.md / AGENTS.md).

## Risks & open questions (revised — post-Phase-5 state)

1. **assistant-ui / Base UI compat** — moot: assistant-ui is dropped (1c4dace).
2. **Sonner → Base UI toast** — resolved: **keeping Sonner** intentionally
   (user decision, 2026-10-02).
3. **`cn` package compat with Base UI** — resolved during Phase 3 (typecheck +
   lint clean).
4. **`shadcn/tailwind.css` runtime dep** — resolved in Phase 3 (base-nova
   builds green).
5. **Per-component commit cadence** — followed throughout.
6. **Lombiq `tailwind-4-docs` sync** — done (Phase 0).
7. **beui.dev + assistant-ui coexistence** — moot: both never coexisted; the
   beui rebuild removed assistant-ui in the same change.

## Execution order

- Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 (sequential).
- Phase 1 minimal, can overlap with 3 prep.
- Phase 4 / 5 can run in parallel after Phase 3 if scope allows.
- **Actual sequencing**: Phase 6's doc side (39ac863) landed mid-Phase-4, ahead
  of Phase 5 — intentional, since it was doc-only. Its "concrete pages"
  follow-ups are the next actions in `docs/UI-UX-DIRECTION.md`. Phase 5 and
  the final cleanup have since landed (1c4dace, 5210a4c), the last Phase 4
  leftover (`@coss/table` + ImportPage) is done (bf6d73c), and the
  outstanding-refactors batch (items 3–10) landed immediately after. All
  phases and follow-ups complete.

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
  `ActionBar`, etc. (replaced by the beui chat in Phase 5).

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
| `@coss/field` | ✅ | 3 dialog forms refactored onto it (`.migration/coss-field.md`) |
| `@coss/table` | ✅ | `ImportPage` right pane on table semantics (`.migration/coss-table.md`) |

## Status snapshot

- 40 commits on `main` since the plan was approved (as of this update).
- All workspaces typecheck clean; lint green (warnings only — pre-existing
  `react-perf` hints plus 2 new ones on `ChatPanel.tsx`, same acceptable
  category); build green.
- Deps now: `@assistant-ui/*`, `cmdk`, and `radix-ui` all removed;
  `@ai-sdk/react@^4.0.130`, `motion@^13.5.0`, `react-markdown@^10.1.0` and
  `remark-gfm@^4.0.1` added; `ai@^7.0.127` stays (transport, `UIMessage`
  types, `sendAutomaticallyWhen`); **Sonner stays** as the toast system
  (resolved decision).
- beui primitives vendored under `apps/web/src/components/agents/` +
  `apps/web/src/components/motion/` (+ small `lib/` helpers), excluded from
  lint via `.oxlintrc.json` `ignorePatterns`.
- `components/assistant-ui/` and `hooks/use-attachment-src.ts` deleted.
- 15 migration reports in `.migration/` (Phase 3 base-ui ports + Phase 4 coss
  adoptions).

## Outstanding refactors (surfaced for follow-up)

1. ~~**`@coss/field`** + refactor `AddBookmarkDialog`, `BookmarkDetailDialog`,
   `VocabDialog` (and 3-cluster triplication) to use it.~~ ✅ done (field
   adoption landed with the 3-dialog refactor; see `.migration/coss-field.md`).
2. ~~**`@coss/table`** + rewrite `ImportPage` editable rows on table
   semantics.~~ ✅ done (`ImportPage` right pane on `variant="card"` table; see
   `.migration/coss-table.md`).
3. ~~**`BookmarkCard` → coss Card anatomy** in `BookmarkList.tsx:143-203`.~~
   ✅ done (coss `Card` root, hover/focus-within actions, new skeleton).
4. ~~**List keyboard navigation** for `BookmarkList.tsx`~~ ✅ done (roving
   tabindex over semantic `<ul>`/`<li>`, arrows/Home/End/Enter/Delete, grid-aware).
5. ~~**Topbar redesign**~~ ✅ done (search hero + attached mode segmented
   control, Create split-button, account menu).
6. ~~**Library entrance + pagination crossfade** motion.~~ ✅ done (mount-only
   10-card stagger; slot-based 150 ms crossfade; reduced-motion safe).
7. ~~**Tag assignment combobox** in `BookmarkDetailDialog.tsx`~~ ✅ done
   (searchable combobox with inline creation through the existing add-tag path).
8. ~~**Command palette wiring** (`Cmd/Ctrl+K`)~~ ✅ done (search + category/tag
   jumps + localStorage recent queries; works while typing).
9. ~~**Markdown rendering for assistant chat text**~~ ✅ done — `react-markdown`
   + `remark-gfm` (user-approved deps); user messages stay plain text.
10. ~~**Chat "cite" action**~~ ✅ done (copies a markdown list of the assistant
    message's `searchBookmarks` sources, with a most-recent-result fallback).

## Source files referenced

- `docs/DESIGN.md` — refreshed design system contract (base-ui + coss/beui).
- `docs/UI-UX-DIRECTION.md` — companion doc with audit + direction + next actions.
- `docs/ARCHITECTURE.md` — system architecture (precedence: ARCHITECTURE > MODEL >
  DESIGN > README).
- `apps/web/components.json` — `base-nova` style + `@coss` / `@beui` registries.
- `apps/web/src/components/ui/*` — 28 base-ui + coss wrappers (was 22 stock).
- `apps/web/src/components/agents/*` + `components/motion/*` — vendored beui
  primitives (Phase 5 chat surface).
- `.migration/*.md` — per-component migration reports (15 files).

## Known limitation (environmental)

- Chat markdown/cite are code-complete and gated (typecheck/lint/build/tests
  green) but could not be end-to-end smoked in this environment: the local
  Ollaya sidecar serves only routing/ONNX models and refuses `/api/chat`
  ("decision models do not generate text"). Setting `OLLAMA_CHAT_MODEL` (and
  `OLLAMA_URL=http://127.0.0.1:11435`) to a text model enables the full path.
  The unconfigured/error path was smoke-verified calm (alert renders, transcript
  and composer intact).