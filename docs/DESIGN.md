# al-yo-bo — Design System

> This is a **starting point** — evolve it deliberately as the UI is built, and keep it the single reference for components and pages.

## Principles

1. **Calm, dense, keyboard-first.** It is a single-user tool for a developer: information density and
   keyboard navigation beat decoration.
2. **Copy-paste, not lock-in.** Components come from **shadcn/ui** and live in the repo as source —
   they are ours to edit, not a themed black box.
3. **Two modes, one mental model.** Chat and the traditional list/grid UI are peers; switching between
   them must not lose context (filters, selection).
4. **Accessible by default.** WCAG AA contrast, full keyboard reachability, visible focus, and
   labelled controls. shadcn/ui + Radix give the primitives — do not bypass them.

## Foundation

| Token       | Value                                | Notes                                                     |
| ----------- | ------------------------------------ | --------------------------------------------------------- |
| Base unit   | `4px` (Tailwind spacing scale)       | Use scale steps (`2`, `3`, `4`, `6`, …), not arbitrary px |
| Radius      | `--radius` (shadcn default `0.5rem`) | Cards, inputs, popovers inherit it                        |
| Font (UI)   | Work Sans Variable                   | Via `font-sans`; loaded from `@fontsource-variable/work-sans` |
| Font (mono) | system mono stack                    | For URLs, hashes, code (`font-mono`)                      |
| Type scale  | Tailwind `text-xs` → `text-2xl`      | Body `text-sm`; page titles `text-2xl`                    |
| Color       | shadcn **CSS variables** (oklch)     | Define semantic tokens, never raw hex in components       |

**Color rule:** consume semantic tokens only — `background`, `foreground`, `muted`, `muted-foreground`,
`primary`, `secondary`, `accent`, `destructive`, `border`, `ring`, `card`, `popover`. Light and dark
themes are the same tokens with different values; never branch on theme in component code.

**Status colors** map to meaning, reserved (not decorative): category chips and tag confidence use
`muted`/`accent`; classification states use a documented palette (active = `primary`,
deprecated = `muted-foreground`). Vocabulary no longer has a `proposed` state — the importer
creates it active, and classifier output is either auto-assigned or a below-threshold suggestion.

## Components (shadcn/ui on base-ui)

- **Substrate: base-ui.** All `src/components/ui/*` wrappers import from `@base-ui/react/*` (style
  `base-nova`, set in `apps/web/components.json`). Phase 3 migrated every primitive from radix to
  base-ui. Radix is no longer a direct dependency of feature code; `radix-ui` is retained only while
  assistant-ui transitively pulls it (removed in Phase 5).
- **Registries.** `apps/web/components.json` registers two non-default registries alongside the
  built-in shadcn registry:
  - `@coss` → `https://coss.com/ui/r/{name}.json` — production-tuned base-ui components
  - `@beui` → `https://beui.dev/r/{name}.json` — motion-first AI/agent primitives
  Add with `bunx shadcn@latest add @coss/<name>` or `@beui/<name>`; prefer over the universal shadcn
  registry when a coss/beui equivalent exists.
- **Add with the CLI.** `bunx shadcn@latest add <component>` for shadcn primitives;
  `bunx --bun shadcn@latest add @coss/<component>` for coss; `@beui/<component>` for beui. Load
  the **shadcn** skill (and the **migrate-radix-to-base** skill for refactors) for guardrails.
- **Copy-paste, ours to edit.** Generated wrappers stay under `src/components/ui/`; they are the
  single source of truth for the design system — fork freely.
- **Compose, don't fork.** Wrap primitives in feature components (`BookmarkCard`, `TagChip`,
  `CategoryNav`) under `src/components/`; feature components may consume both shadcn and coss/beui
  wrappers.
- **Variants over ad-hoc classes.** Use `cva` variant maps; no conditional Tailwind soups in JSX.
- **Polymorphic primitives** use base-ui's `render` prop, not radix's `asChild`:
  `<Trigger render={<Button/>}>...</Trigger>`.
- Canonical building blocks: `button`, `input`, `input-group`, `label`, `dialog`, `alert-dialog`,
  `dropdown-menu`, `command`, `popover`, `badge`, `card`, `tabs`, `scroll-area`, `separator`,
  `toast`/`sonner`, `table`, `tooltip`. (`card` is currently dead — wire it through `BookmarkCard`.)

## Layout & responsive

- App shell: persistent left **navigation/category** rail, main content area, optional right **chat**
  panel that can take over the main area.
- Default view is a **list**; a **grid** toggle persists locally in the browser (`localStorage`). It is
  a per-browser preference, not server state.
- Breakpoints follow Tailwind defaults (`sm`/`md`/`lg`). The nav rail has three tiers: full labelled
  rail at `≥lg`, icon rail (with tooltips and the review-count badge) at `md–lg`, and below `md` the
  rail is hidden — the topbar menu button opens it as an off-canvas sheet. Chat becomes full-screen
  (right sheet) below `md`; above that it is an inline `24rem` panel.
- Empty, loading, and error states are designed, not afterthoughts — every list needs a skeleton and
  an empty state with the primary action.

## App shell reference (Grimoire demo)

The public demo at <https://goniszewski.com/grimoire/demo/> is used as a **layout and seed-data
reference** (see ARCHITECTURE §7 for the seed fixture, and `.omo/evidence/` for screenshots). It is a
different product: borrow the information architecture, not the feature set.

**Borrow:**

- Left rail: `All` (with total), a flat list of categories with counts, a tag list with counts; a
  collapse control below `lg`.
- Top bar: a single search input (with a keyword/semantic/hybrid mode control), plus add/import/theme
  actions.
- Main area: result count, a "refine" filters popover, list/grid toggle, sort control, and pagination
  (default 20/page).
- Bookmark row: title, host, tag chips, and a short description; row actions on the right.
- A dedicated review-queue surface with a pending count badge.

**Do not adopt (out of scope for al-yo-bo):** Domains, Timeline, Archive, Suggestions, pin/read-later/
opened-count counters — unless they are separately requested and added to these docs.

## Interaction & motion

- **Timing tokens** (the single source for the project — pick library, theme, layout, motion all
  defer here):
  - `150 ms` — hover/press feedback (button states, card hover, link transitions)
  - `200 ms` — state changes (mode toggle, layout, filter changes, dialog backdrop)
  - `250–300 ms` — panel/sheet entrances, command palette open/close
  - Easing: `ease-out` for entrances, `ease-in-out` for layout resizes
- Respect `prefers-reduced-motion` — disable translate/scale animations; keep opacity transitions
  only.
- One well-timed entrance animation beats scattered micro-interactions. Page-load entrance stagger
  for the library view (`200 ms`, `translate-y-1 → 0`, opacity `0 → 1`); pagination crossfade
  (`150 ms`); filter change pulse on the result count.
- Optimistic mutations must show pending affordance and a recovery path on failure.
- Keyboard: `/` focuses search, `c` opens chat, `Esc` closes overlays, **arrows move list
  selection** (see accessibility checklist — this is the missing piece).
- Focus states use the `ring` token and must remain visible on every interactive element.

## Import page

- Route `#/import` (minimal hash router), rendered inside the app shell — the sidebar and topbar
  stay put; only the main column swaps. The Topbar "Import" button and the empty-library "Import"
  action navigate there; a successful commit returns to `#/library` with an added/updated toast.
- **Vertical split**, two bordered panes at ~50/50 on `md`+, stacked below `md`:
  - **Left — source.** `Tabs` (line variant) with "Paste text" (borderless mono `Textarea`, the
    pane is the input) and "Upload file"; an uploaded file's contents are shown in the paste tab so
    nothing is extracted sight-unseen. A primary **Extract** button lives in the pane header and is
    disabled while the text is empty or a request is in flight. A slim status line beneath the pane
    (`aria-live`) reports the provider from the preview response — "Extracted by LLM" or
    "Fallback: deterministic parser" — with parsed/skipped counts.
  - **Right — editable result.** The header shows an included/total count badge and a duplicate-URL
    merge hint when the paste repeats a URL. Rows render as a `@coss/table` (`variant="card"`) with
    a sticky header and horizontal scroll on narrow viewports: Include, Bookmark (title, URL,
    description stacked), Category, Priority, Tags, Remove. Each field is a borderless-until-hover
    input inside its cell; excluded rows dim to 50% opacity instead of disappearing, keeping the
    choice reversible. Extraction shows skeleton rows; the empty state explains the flow.
- **Sticky commit bar** at the right pane's bottom: "Cancel" (clears the extraction, keeps the
  pasted text) and a primary "Import N bookmarks" whose count tracks the included rows live.
- Edits stay client-side until commit — the server only ever receives the rows the user confirmed.

## Bookmark imagery

- Bookmarks render a visual from `metadata.image` with a fixed fallback chain, in both the list/grid
  card thumbnail and the detail dialog header: **local screenshot** (`/data/screenshots/<file>`, the
  stored path is validated against the server's filename guard before use) → **remote og:image**
  (loaded with `crossOrigin="anonymous"` + `referrerPolicy="no-referrer"`) → **placeholder** (a
  `bg-muted` block with a globe mark — no external favicon service).
- A failed image load (`onError`) falls through to the placeholder; the UI never shows a broken
  image. Both surfaces crop with `object-cover object-top` so page heroes read well.

## Chat (beui.dev)

- The chat surface uses **beui.dev** primitives (`message-bubble`, `prompt-input`,
  `streaming-response`, `agent-activity`, `message-scroller`) — installed from the `@beui`
  registry. assistant-ui is being retired in Phase 5.
- Streaming, tool-call, and error states each get a distinct, calm presentation; never block the
  transcript on a failed tool call.
- Message actions (copy, cite, "open bookmark") are always available, not hover-only.
- The chat tool-result surface (bookmark hits) reuses `BookmarkCard` from the library for visual
  consistency between chat and main view.
- Once the chat panel is fully on beui, drop `@assistant-ui/react` from `apps/web` deps; this
  transitively retires `radix-ui` from the project.

## Accessibility checklist

- [ ] Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI/graphics (both themes).
- [ ] Every control reachable and operable by keyboard, with a visible focus ring.
- [ ] Inputs have labels; icon-only buttons have `aria-label`.
- [ ] Live regions for streaming/async updates (search results, chat).
- [ ] No meaning conveyed by color alone (pair with icon/text).
- [ ] **List keyboard navigation.** `BookmarkList` and the import result grid support `↑`/`↓` to
      move selection, `Enter` to open, `Delete`/backspace to remove. Roving tabindex pattern; the
      list has `role="listbox"` semantics for screen readers.
- [ ] "Skip to results" link for screen-reader/keyboard users.
- [ ] Focus trap verified on every dialog (`BookmarkDetailDialog`, `VocabDialog`, `AddBookmarkDialog`,
      the `AlertDialog` nested in `BookmarkDetailDialog`).
- [ ] Verify `--muted-foreground` against `--background` in both themes; darken if below AA.
