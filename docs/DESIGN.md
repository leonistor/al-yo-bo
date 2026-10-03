# al-yo-bo — Design System

> Single reference for components and pages. When a change contradicts this doc, update the doc as
> part of the change.

## Principles

1. **Calm, dense, keyboard-first.** It is a single-user tool for a developer: information density and
   keyboard navigation beat decoration.
2. **Quiet surfaces.** Structure comes from 1px borders and surface tint — not shadows, gradients, or
   decorative motion. Elevation is reserved for overlays.
3. **Two modes, one mental model.** Chat and the traditional list/grid UI are peers; switching between
   them must not lose context (filters, selection).
4. **Copy-paste, not lock-in.** Components come from **shadcn/ui** and live in the repo as source —
   they are ours to edit, not a themed black box.
5. **Accessible by default.** WCAG AA contrast, full keyboard reachability, visible focus, and
   labelled controls. shadcn/ui + base-ui give the primitives — do not bypass them.

## Foundation

| Token       | Value                                | Notes                                                     |
| ----------- | ------------------------------------ | --------------------------------------------------------- |
| Base unit   | `4px` (Tailwind spacing scale)       | Scale steps only (`2`, `3`, `4`, `6`, …); no arbitrary px. Sole exception: the JS-driven sidebar width |
| Radius      | `--radius: 0.625rem`                 | `rounded-md` compact controls · `rounded-lg` cards/panels/sheets · `rounded-full` **pills only** |
| Font (UI)   | Figtree Variable                     | Via `font-sans`; loaded from `@fontsource-variable/figtree` |
| Font (mono) | system mono stack                    | For URLs, hashes, code (`font-mono`); `tabular-nums` on counts |
| Color       | shadcn **CSS variables** (oklch)     | Semantic tokens only — never raw hex/Tailwind palette values in token definitions or components |

**UI font alternatives, evaluated Oct 2026** (comparison screenshots in `.omo/evidence/fonts/`, uncommitted): Geist, Inter, Manrope, Atkinson Hyperlegible Next. Figtree chosen for warm-but-crisp rendering at dense list sizes. Geist = runner-up (sharpest, but sterile); Atkinson rejected as default — larger metrics wrap sidebar tags and cost list density; Inter dropped for ubiquity.

**Type scale** (roles, not suggestions):

| Role                                   | Step        |
| -------------------------------------- | ----------- |
| Counts, meta, captions, section labels | `text-xs`   |
| Body, rows, buttons, inputs, labels    | `text-sm`   |
| Bookmark titles, sheet titles          | `text-base` |
| Page titles (`h1` in main column)      | `text-lg`   |

**Spacing rhythm:** main column `p-4` · cards `p-3` · inline control gaps `gap-2` · section gaps
`gap-3` · chrome (`Topbar`, `Sidebar`) `px-3 sm:px-4`.

**Elevation policy:** flat. All static surfaces are separated by `1px` borders (`border-border`,
`border-sidebar-border`) and surface tint — never shadows. `shadow-sm` is allowed **only on
overlays**: popovers, dropdown menus, the command palette, and sheets. No gradients, no
drop-shadows, no diffuse elevation.

**Color rule:** consume semantic tokens only — `background`, `foreground`, `muted`,
`muted-foreground`, `primary`, `secondary`, `accent`, `destructive`, `border`, `ring`, `card`,
`popover`. Light and dark themes are the same tokens with different values; never branch on theme in
component code.

**Status colors** map to meaning, reserved (not decorative): category chips and tag confidence use
`muted`/`accent`; classification states use a documented palette (active = `primary`,
deprecated = `muted-foreground`). Vocabulary is created active by the importer; classifier output is
either auto-assigned or a below-threshold suggestion.

**Surfaces:**

| Surface        | Token                                   |
| -------------- | --------------------------------------- |
| Sidebar        | `bg-sidebar` / `text-sidebar-foreground` + `border-r border-sidebar-border` |
| Content column | `bg-background`                          |
| Cards          | `bg-card`                                |
| Overlays       | `bg-popover` / sheets `bg-background`    |
| Active row     | `bg-accent` / `text-accent-foreground`   |

## App shell

Left sidebar + right content, split by the sidebar's right border. The content column owns a
**two-row header**; the sidebar owns navigation and less-frequent tools.

```
┌──────────┬────────────────────────────────────────────┐
│ Sidebar  │ Command bar (h-12, border-b, bg-background)│
│ bg-sidebar│ ──────────────────────────────────────────│
│ border-r │ main (p-4)                                 │
│          │  ┌ Results toolbar (row 2 of the header)   │
│          │  ├ list / grid (scrolls)                   │
│          │  └ pagination                              │
│          │                      [chat 24rem, optional]│
└──────────┴────────────────────────────────────────────┘
```

### Sidebar — collapsible & resizable

- **Expanded:** default `256px`; drag-resizable between `200px` and `360px`. The resize handle is a
  `4px` invisible hit area on the right edge with a 1px visible divider; cursor `ew-resize`.
- **Collapsed:** `56px` icon rail (`w-14`): brand/expand button on top; account and theme
  buttons below it; icon entries with tooltips (label + count) for All, Review, Categories, Tags;
  footer icons for Import, Vocabulary, Share. Rail buttons render at `icon-lg`. Badges sit at the
  button's top-right corner, partially outside so they don't overlap the glyph. Active entries
  use `bg-sidebar-accent`.
- **Snap rule:** dragging below `200px` snaps to the rail; dragging right from the rail restores the
  last expanded width.
- **Persistence:** `localStorage` — `ayb:sidebar:width`, `ayb:sidebar:collapsed`,
  `ayb:sidebar:sections` (open/closed map). Restored on mount without flash.
- **Keyboard:** `Cmd/Ctrl+B` toggles collapsed/expanded.
- **Responsive:** `≥md` shows the persistent sidebar (expanded or rail). Below `md` the sidebar is
  hidden; the command bar's menu button opens the full nav as an off-canvas left `Sheet` (same
  `SidebarNav` body).

### Sidebar information architecture

1. **Views:** All bookmarks (total badge), Review queue (pending count badge).
2. **Library — collapsible groups:** each Section is a `CollapsibleSection` header; category rows
   indent `pl-4` under a 2px `border-l` guide. Tags are a collapsible group rendered as **pills with
   the count inside** (no icon-text rows).
3. **Header (expanded):** brand icon + wordmark, total badge, account menu, theme toggle,
   collapse button. The sidebar header — not the topbar — owns Profile & theme.
4. **Tools (footer, less-frequent):** Import, Vocabulary, Share.

### Command bar (content header, row 1)

`h-12`, `border-b border-border`, `bg-background`, spans the content width — visually distinct from
the tinted sidebar by surface and border, never by shadow. Left→right:

1. Menu button (`md:hidden`) — opens the off-canvas nav sheet.
2. Search input group — flex-1, `max-w-xl`, `/` focuses, attached keyword/semantic/hybrid segmented
   control.
3. Chat toggle (`c`).
4. **Add** — plain primary button (Import lives in the sidebar Tools).

### Results toolbar (content header, row 2)

Sits at the top of `main`, directly above the list: result count (`aria-live`, `text-sm
text-muted-foreground`) and Active/Invalid segmented control on the left; sort select, list/grid
segmented control, refresh on the right. Sort options fold direction in: Newest / Oldest / Recently
updated / Title A–Z / Title Z–A.

## Components (shadcn/ui on base-ui)

- **Substrate: base-ui.** All `src/components/ui/*` wrappers import from `@base-ui/react/*` (style
  `base-nova`, set in `apps/web/components.json`). Radix is not a direct dependency of feature code.
- **Registries.** `apps/web/components.json` registers, alongside shadcn:
  - `@coss` → `https://coss.com/ui/r/{name}.json` — production-tuned base-ui components
  - `@beui` → `https://beui.dev/r/{name}.json` — motion-first AI/agent primitives
  Add with `bunx shadcn@latest add @coss/<name>` or `@beui/<name>`; prefer over the universal shadcn
  registry when a coss/beui equivalent exists.
- **Copy-paste, ours to edit.** Generated wrappers stay under `src/components/ui/`; they are the
  single source of truth for the design system — fork freely.
- **Compose, don't fork.** Wrap primitives in feature components (`BookmarkCard`, `TagPill`,
  `CollapsibleSection`) under `src/components/`; feature components may consume shadcn, coss, and
  beui wrappers.
- **Variants over ad-hoc classes.** Use `cva` variant maps; no conditional Tailwind soups in JSX.
- **Polymorphic primitives** use base-ui's `render` prop: `<Trigger render={<Button/>}>...</Trigger>`.
- Canonical building blocks: `button`, `input`, `input-group`, `label`, `sheet`, `alert-dialog`,
  `dropdown-menu`, `command`, `popover`, `badge` (non-tag counts only), `card`, `tabs`,
  `scroll-area`, `separator`, `collapsible`, `toast`/`sonner`, `table`, `tooltip`.

### TagPill — the one tag visual

`src/components/TagPill.tsx` (cva). Every tag everywhere — rows, cards, sidebar, detail sheet, chat
tool results, import preview, vocabulary page — renders through it. Ad-hoc tag `Badge` usage is a
defect.

- Anatomy: `inline-flex items-center gap-1 h-5 px-2 rounded-full border text-xs font-medium
  whitespace-nowrap`. Size `md` (detail/edit surfaces): `h-6 px-2.5 text-sm`.
- Variants:
  - `outline` — default clickable filter pill (`hover:bg-accent`); clicking filters the library by
    that tag.
  - `selected` — active filter (`bg-primary text-primary-foreground`); used in the sidebar tag list
    for the current selection.
  - `removable` — `secondary` + trailing `×` button (detail sheet assignments).
  - `static` — non-interactive (`bg-secondary`), for read-only contexts.
- Sidebar pills carry the count inside (`text-muted-foreground`, `tabular-nums`).

### CollapsibleSection — the one collapsible group

`src/components/CollapsibleSection.tsx` on the base-ui `collapsible` primitive. Used for sidebar
Sections, category groups, and the Tags group; reused wherever a collapsible group is needed.

- Header: `h-8 px-2 flex items-center gap-2` — chevron `size-3.5` (`text-muted-foreground`, rotates
  90° on open, `transition-transform duration-150`), label `text-xs font-medium text-muted-foreground
  uppercase tracking-wide`, count right-aligned `tabular-nums`.
- Content height animation `200ms`; keyboard operable via the base-ui trigger.
- Open/closed state persists (sidebar: `ayb:sidebar:sections`).

### Sheets and pages — not dialogs

Detail/editing surfaces are **right-anchored sheets** or **routes**, never modal dialogs. Context
stays visible; `Esc` closes; focus is trapped and restored by the sheet primitive.

| Surface                  | Treatment                                                                 |
| ------------------------ | ------------------------------------------------------------------------- |
| Bookmark detail          | `BookmarkDetailSheet` — right, `w-full sm:max-w-xl`, sticky image header, scrollable body, footer actions; delete confirm is an `AlertDialog` triggered from within |
| Add bookmark             | `AddBookmarkSheet` — right, `w-full sm:max-w-md`                           |
| Vocabulary management    | `VocabularyPage` — route `#/vocabulary` inside the shell (too much data for a sheet) |
| Import                   | `ImportPage` — route `#/import` inside the shell                           |
| Share                    | `SharePage` — route `#/share` inside the shell                             |
| Destructive confirmation | `AlertDialog` (the one legitimate modal — interruptions must interrupt)    |

Sheet entrances are `translate-x` + opacity, `200ms ease-out`; reduced-motion falls back to
opacity-only.

## Interaction & motion

- **Timing tokens** (the single source — pick library, theme, layout, motion all defer here):
  - `150 ms` — hover/press feedback (button states, card hover, link transitions)
  - `200 ms` — state changes (mode toggle, layout, filter changes, collapsibles, sheets)
  - `250–300 ms` — command palette open/close
  - Easing: `ease-out` for entrances, `ease-in-out` for layout resizes
- Respect `prefers-reduced-motion` — disable translate/scale animations; keep opacity transitions
  only.
- **Motion budget.** One well-timed entrance beats scattered micro-interactions:
  - Keep: pagination crossfade (`150 ms`, opacity-only); list entrance stagger capped at the first
    6 items (`translate-y-1 → 0`, opacity); the chat scroller's navigation rail and the thinking
    shimmer (chat-scoped, see Chat).
  - Cut, app-wide: magnetic/cursor-follow buttons, metallic buttons, morphing popovers, custom
    animated selects, marketing shimmer outside chat loading states. Standard primitives
    (`ui/popover`, `ui/select`, `ui/button`) win over bespoke motion wrappers.
- **Command palette** (`Cmd/Ctrl+K`) combines bookmark search, category/tag jumps, and recent
  queries. Autofocus on open, full arrow navigation, restores focus on close, routes selections into
  the library search/filter state.
- Optimistic mutations must show pending affordance and a recovery path on failure.
- Keyboard: `/` focuses search, `c` opens chat, `Cmd/Ctrl+K` command palette (works while typing in
  inputs), `Cmd/Ctrl+B` sidebar, `Esc` closes overlays, **arrows move list selection**.
- Focus states use the `ring` token and must remain visible on every interactive element.

## Import page

- Route `#/import`, rendered inside the app shell — sidebar and header stay put; only the main column
  swaps. Sidebar Tools → Import navigates there; a successful commit returns to `#/library` with an
  added/updated toast.
- **Vertical split**, two bordered panes at ~50/50 on `md`+, stacked below `md`:
  - **Left — source.** `Tabs` (line variant) with "Paste text" (borderless mono `Textarea`) and
    "Upload file"; an uploaded file's contents are shown in the paste tab so nothing is extracted
    sight-unseen. A primary **Extract** button in the pane header, disabled while the text is empty
    or a request is in flight. A slim status line beneath the pane (`aria-live`) reports the provider
    — "Extracted by LLM" or "Fallback: deterministic parser" — with parsed/skipped counts.
  - **Right — editable result.** Header shows an included/total count badge and a duplicate-URL
    merge hint. Rows render as a `@coss/table` (`variant="card"`): Include, Bookmark (title, URL,
    description stacked), Category, Priority, Tags (parsed tags preview as `TagPill`s), Remove.
    Fields are borderless-until-hover inputs; excluded rows dim to 50% opacity, keeping the choice
    reversible. Extraction shows skeleton rows; the empty state explains the flow.
- **Sticky commit bar** at the right pane's bottom: "Cancel" and a primary "Import N bookmarks" whose
  count tracks the included rows live.
- Edits stay client-side until commit — the server only ever receives the rows the user confirmed.

## Share page

- Route `#/share`, rendered inside the app shell. Sidebar Tools → Share navigates there.
- **Purpose:** open the app from other devices on the LAN (e.g. a phone). Lists one bordered card
  per LAN interface with a QR code (`qrcode.react`) encoding that interface's URL; cards use token
  colors (`bg-card`, `var(--foreground)` for the QR modules), show the URL as truncated mono text,
  and a copy button with a transient "Copied" state.
- **Degradation:** when interfaces can't be read, a single `LocalFallbackCard` shows this device's
  origin URL as the QR — same card treatment, no error surface.

## Bookmark imagery

- Bookmarks render a visual from `metadata.image` with a fixed fallback chain, in both the list/grid
  card thumbnail and the detail sheet header: **local screenshot**
  (`/data/screenshots/<file>`, validated against the server's filename guard) → **remote og:image**
  (`crossOrigin="anonymous"` + `referrerPolicy="no-referrer"`) → **placeholder** (`bg-muted` block
  with a globe mark — no external favicon service).
- A failed image load (`onError`) falls through to the placeholder; the UI never shows a broken
  image. Both surfaces crop with `object-cover object-top`.

## Chat (beui.dev)

- The chat surface uses **beui.dev** primitives (`message-bubble`, `prompt-input`,
  `streaming-response`, `agent-activity`, `message-scroller`) from the `@beui` registry.
- **Chat-scoped motion exceptions:** the message scroller's `PreviewRail` (transcript mini-map with
  hover previews) and the thinking `TextShimmer` are functional chat affordances and are the only
  sanctioned uses of those motion components. Chat's prompt input uses standard `ui/button`,
  `ui/popover`, `ui/select` — not motion wrappers.
- Streaming, tool-call, and error states each get a distinct, calm presentation; never block the
  transcript on a failed tool call.
- Message actions (copy, cite, "open bookmark") are always available, not hover-only.
- Assistant text renders as GFM (`react-markdown` + `remark-gfm`, memoized per message); user
  messages stay plain text.
- **Cite** copies a markdown list of source bookmarks from the current assistant message's
  `searchBookmarks` tool results; standard Sonner toast feedback.
- The chat tool-result surface reuses `BookmarkCard` (and therefore `TagPill`) from the library.

## Accessibility checklist

- [ ] Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI/graphics (both themes).
- [ ] Every control reachable and operable by keyboard, with a visible focus ring.
- [ ] Inputs have labels; icon-only buttons have `aria-label`.
- [ ] Live regions for streaming/async updates (search results, chat).
- [ ] No meaning conveyed by color alone (pair with icon/text).
- [ ] **List keyboard navigation.** `BookmarkList` and the import result grid support `↑`/`↓` to
      move selection, `Enter` to open, `Delete`/backspace to remove (grid: `←`/`→`, column-aware
      `↑`/`↓`, Home/End). Roving tabindex; `role="list"`/`role="listitem"` semantics.
- [ ] "Skip to results" link for screen-reader/keyboard users.
- [ ] Focus trap verified on every sheet (`BookmarkDetailSheet`, `AddBookmarkSheet`) and the
      `AlertDialog` triggered from within; focus restored on close.
- [ ] Verify `--muted-foreground` against `--background` in both themes; darken if below AA.

## Deferred UI/UX improvements (iteration 2)

1. Card elevation/radius normalization — base Card uses `shadow-xs` + `rounded-2xl`
   (`ui/card.tsx:15`), deviating from the flat no-shadow aesthetic and `--radius` token; restyle
   to flat, token-only radii.
2. Unify sidebar nav trees — mobile sheet body (`Sidebar.tsx` ~:261-371) and collapsed rail
   (~:570-617) are parallel nav trees with diverging badge/count rendering; extract one shared
   renderer.
3. Unify tag pill wrappers — `TagItem` (`Sidebar.tsx` ~:120-132) and `BookmarkTagPill`
   (`BookmarkList.tsx` ~:155-166) both wrap `TagPill` with slightly different behavior;
   consolidate.
4. Motion + empty-state pass — apply DESIGN.md motion tokens to sidebar collapse/sheet
   transitions; review empty/skeleton states against imagery fallback rules.
