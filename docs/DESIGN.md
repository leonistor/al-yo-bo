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

**Spacing rhythm:** main column `p-4` · cards `p-3` · dense tiles and compact list rows `p-2`
(dense grid + chat results + `DenseBookmarkRow`) · inline control gaps `gap-2` · section gaps
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
deprecated = `muted-foreground`). Vocabulary is created active by the importer or the setup wizard;
classifier output is either auto-assigned (above threshold) or ignored.

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

### Route page width convention

Route pages (`#/library`, `#/import`, `#/share`, `#/vocabulary`, `#/profile`) fill the content
area; the internal layout (single column, two column, or split panes) is page-specific. Do not
impose an arbitrary `max-w-*` on a whole route page. Profile uses a two-column card layout;
Import uses side-by-side panes; Share and Vocabulary use full-width single-column layouts.

```
┌──────────┬────────────────────────────────────────────┐
│ Sidebar  │ Command bar (h-12, border-b, bg-background)│
│ bg-sidebar│ ──────────────────────────────────────────│
│ border-r │ main (p-4)                                 │
│          │  ┌ Results toolbar (row 2 of the header)   │
│          │  ├ list / compact / grid / dense (scrolls)  │
│          │  └ pagination                              │
│          │                      [chat 24rem, optional]│
└──────────┴────────────────────────────────────────────┘
```

### Sidebar — collapsible & resizable

- **Expanded:** default `256px`; drag-resizable between `200px` and `360px`. The resize handle is a
  `4px` invisible hit area on the right edge with a 1px visible divider; cursor `ew-resize`.
- **Collapsed:** `56px` icon rail (`w-14`): brand/expand button on top; account and theme
  buttons below it; icon entries with tooltips (label + count) for All, Categories, Tags;
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

1. **Views:** All bookmarks (total badge).
2. **Library — collapsible groups:** each Section is a `CollapsibleSection` header; category rows
   indent `pl-4` under a 2px `border-l` guide. Tags are a collapsible group rendered as **pills with
   the count inside** (no icon-text rows).
3. **Header (expanded):** brand icon + wordmark, account menu, theme toggle,
   collapse button. The sidebar header — not the topbar — owns Profile & theme. No total badge
   here: the "All bookmarks" view row already renders it.
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
text-muted-foreground`) and Active/Invalid segmented control on the left; sort select, list/
compact/grid/dense four-way segmented control (List / Rows3 / LayoutGrid / Grid3x3), refresh on
the right. Below `sm` the layout segmented control hides (the `ayb:layout` preference is owned by
Profile); sort and refresh stay. Sort options fold
direction in: Newest / Oldest / Recently updated / Title A–Z / Title Z–A.

## Setup wizard

First-run flow, gated by `profile.setup_completed_at == null`. Until the wizard finishes, render it
instead of the app shell. Already-seeded workspaces (including the octocat fixture) set
`setup_completed_at`, so the wizard is normally skipped in development.

**Steps:**

1. **Identity** — name and GitHub username as plain controlled inputs, committed together by the
   step's Continue button to `PATCH /api/profile` (empty values allowed; one-time entry, not the
   Profile page's inline-edit pattern).
2. **Developer profile** — questionnaire (source, focus one-of, languages/frameworks/tools
   multi-select with free-text add, experience one-of, optional notes). Uses chips + text inputs;
   values are collected client-side and committed as `devProfile` via `PATCH /api/profile`.
3. **Suggestions** — `POST /api/vocabulary/suggest`. Renders proposed tags and category paths as a
   checkbox list (reuses the import-preview include-checkbox pattern). If the LLM is unavailable,
   show a clear "No LLM configured — skip and import later" state; skipping still marks setup
   complete.
4. **Confirm** — checked entries are sent to `POST /api/vocabulary/bulk`, then setup is marked
   complete with `PATCH /api/profile { setupCompletedAt }`. Uses the same sticky action-bar
   pattern as Import.

Navigation is linear: Back/Next through the steps, with the final step bulk-creating the checked
vocabulary and then marking setup complete.

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

### Count rendering

- **Nav / view counts** (All bookmarks total, category rows, vocabulary status counts):
  render as `Badge variant="secondary"` (or `variant="default"` for emphasis such as a pending import count).
- **Tag counts inside pills** (`TagPill`): render as inline text (`text-muted-foreground tabular-nums`),
  not a `Badge`. For selected pills, use `text-primary-foreground/80` to keep the count readable
  against the primary surface; for `removable`/`static` secondary pills, use
  `text-secondary-foreground/70`.
- **Section / collapsible header counts** and inline meta counts: render as plain
  `text-muted-foreground tabular-nums`.

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

### DenseBookmarkCard + BookmarkThumb — the dense tile

`src/components/DenseBookmarkCard.tsx` — thumbnail-led tile with only **screenshot, title, and
link**. Used by the library's `dense` layout and the chat tool-result surface; no tags,
description, date, or action row (everything else lives in the detail sheet).

- Flat card: `rounded-lg border bg-card p-2`, `hover:bg-accent/50` + 150 ms transition, stagger
  entrance like `BookmarkCard`. Thumbnail flush to the top edges (`-mx-2 -mt-2`, `rounded-t-lg`,
  `aspect-video`).
- Title: `text-sm font-medium truncate` button — the tile's primary control (`data-row-focus`),
  opens the surface's primary action (detail sheet in the library, external tab in chat).
- Link: host as external link — `text-xs text-primary`, trailing `ExternalLinkIcon` (`size-3`),
  `target="_blank" rel="noreferrer"`.
- `src/components/BookmarkThumb.tsx` is the one clickable-thumbnail implementation: the full
  imagery fallback chain (screenshot → og:image → muted globe placeholder) plus the mouse-only
  click affordance (`tabIndex={-1}`; the title button owns keyboard activation). Both cards and
  any future surface consume it — surface-specific sizing passes through `className`.
- Conscious omissions: no Invalid badge (invalid bookmarks stay fully represented in list/grid);
  no per-hit dismiss in chat (chat is a view, never a second library).

### DenseBookmarkRow — the compact layout row

`src/components/DenseBookmarkRow.tsx` — the `compact` layout's row form, the horizontal
counterpart of the dense tile. One line, three zones: a small thumbnail on the left
(`aspect-video w-16`, `rounded-md`, via `BookmarkThumb`), a middle column with the title button
(`text-sm font-medium truncate`, the row's primary control — `data-row-focus`, opens the detail
sheet) above the host external link (`text-xs text-primary`, trailing `ExternalLinkIcon` `size-3`),
and a right-aligned `RowActions` cluster (open in new tab + delete) revealed on hover /
`group-focus-within`. The `list` layout is a different mode: it keeps rendering full
`BookmarkCard`s (thumb, host, description, tag pills) in a `gap-2` vertical stack; `compact`
stacks rows at `gap-1.5`.

- Row chrome follows the managed-list language: `rounded-lg border bg-card p-2`,
  `hover:bg-accent/50`, focus ring inside, stagger entrance capped at the first 10 rows.
- Conscious omissions, same rule as the dense tile: no description, tag pills, or date (they live
  in the detail sheet) and no Invalid badge (invalid bookmarks stay fully represented in
  list/grid).

### List rows & actions — the one managed-list language

Shared primitives under `src/components/` used by every list-like page (Vocabulary, bookmarks,
import): one row anatomy, one action cluster, one destructive confirmation.

- **`EditableRow`** — row chrome: `rounded-lg border border-border bg-card p-3`, hover surface
  (`hover:bg-accent/50`), focus ring inside. Renders as `<li>` inside a `role="list"` when
  `asListItem`. Vocabulary rows, import rows, and skeletons all use it.
- **`RowActions`** — the one action cluster. Icon buttons revealed on hover / `group-focus-within` /
  `pointer-coarse` (`150ms` opacity); >2 actions overflow into a `DropdownMenu` with
  `data-[variant=destructive]` items. Every icon button carries an `aria-label`; roving tabindex
  follows the list's active row.
- **Inline edit** — `useInlineEdit` + `InlineEditInput` (Import-row precedent): borderless-until-hover
  inputs, `Enter` commits, `Esc` cancels, row spinner while pending. `value` must be
  identity-stable across renders (memoize objects) — the hook resyncs the draft on identity change.
- **Keyboard** — `useListKeyboardNav` (extracted from `BookmarkList`): roving tabindex, `↑↓` move
  (grid: column-aware `←→↑↓`), `Home`/`End`, `Enter` activates the row's primary control,
  `Delete`/`Backspace` routes to the same confirm flow as the row's delete action.
- **Destructive confirmation** — `ConfirmDeleteDialog` wraps the `AlertDialog`: title, description,
  and an `impact` list spelling out consequences *before* commit (e.g. tag delete names the
  assignment loss and the classification-evidence destruction — deprecate stays the primary
  "remove from use" action). The only modal in the app.
- **Vocabulary page** — Tabs (line variant) Tags / Categories (Tags first); no Sections tab —
  the v2 data model dropped sections (ARCHITECTURE §5). Per-tab create form
  (existing `Field` pattern), client-side name filter, status pills (active = primary,
  deprecated = muted), usage counts from aggregates. Below `sm` the row's secondary counts
  hide and only the primary row action stays direct — the rest overflow into the kebab.

### Profile & settings page

Route `#/profile`, title "Profile & settings". Content fills the content area like other route
pages; internally it uses a two-column layout on large viewports (`grid grid-cols-1 lg:grid-cols-2`)
with Identity, Preferences and Dataset on the left and System status on the right. Surfaces are
flat cards (`rounded-lg border p-3`). Type scale: page title `text-lg`, labels `text-sm`,
meta/captions `text-xs`. Transitions follow the 150 ms hover / 200 ms state tokens.

- **Identity card** — avatar plus per-field inline edits.
  - Avatar: 48 px (`size-12`), focusable upload trigger (`aria-label="Change avatar"`) with a
    visible focus ring; a matching "Change" button with a camera icon; hidden file input;
    spinner overlay during upload; inline error for >2 MB or wrong type (client-side) plus
    server errors. "Remove" appears only when an avatar exists and is confirmed through the
    shared `AlertDialog` pattern, then calls `DELETE /api/profile/avatar`.
  - Name and GitHub username: each uses `useInlineEdit` + `InlineEditInput`; the display button
    turns into an input on click, `Enter` commits, `Esc` cancels, and focus returns to the
    display button. Each field commits independently to `PATCH /api/profile`; no global Save.
- **Preferences card** — three `SegmentedControl`s:
  - Theme: Sun/Moon/Monitor → light/dark/system, persisted by `lib/useTheme`.
   - Layout: List/Rows3/LayoutGrid/Grid3x3 → list/compact/grid/dense, persisted by
     `lib/useLayout`.
  - Default search mode: Type/Sparkles/Combine → keyword/semantic/hybrid, persisted by
    `lib/useDefaultSearchMode`.
- **Dataset card** — active dataset read-only with caption explaining that switching happens
  via seeding; live switching is a planned follow-up.
- **System status card** — diagnostics, not user settings. One bordered card with compact rows
  for classifier, embeddings, vectors, chat, extract, and screenshot. Each row: icon + name
  (`text-sm`), status Badge (`Available` → primary; `Degraded`/`Unavailable` → destructive or
  muted-foreground, always paired with text), model/provider string in `font-mono text-xs`, and
  enrichment pending count where applicable (not screenshot). A refresh icon button sits in the
  card header; skeleton rows match real row height while loading; per-row degradation on probe
  failure — the panel never collapses into a single error surface.

### Sheets and pages — not dialogs

Detail/editing surfaces are **right-anchored sheets** or **routes**, never modal dialogs. Context
stays visible; `Esc` closes; focus is trapped and restored by the sheet primitive.

| Surface                  | Treatment                                                                 |
| ------------------------ | ------------------------------------------------------------------------- |
| Bookmark detail          | `BookmarkDetailSheet` — right, `w-full sm:max-w-xl`, sticky image header, scrollable body, footer actions; delete confirm is an `AlertDialog` triggered from within |
| Add bookmark             | `AddBookmarkSheet` — right, `w-full sm:max-w-md`                           |
| Vocabulary management    | `VocabularyPage` — route `#/vocabulary` inside the shell (too much data for a sheet) |
| Profile & settings       | `ProfilePage` — route `#/profile` inside the shell                                    |
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

- Bookmarks render a visual from `metadata.image` with a fixed fallback chain, in the list/grid
  card thumbnail, the dense tile, and the detail sheet header: **local screenshot**
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
- The chat tool-result surface reuses `DenseBookmarkCard` (and therefore `BookmarkThumb` and the
  shared imagery fallback chain) from the library, in a two-column tile grid that fits the panel.

## Accessibility checklist

- [ ] Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI/graphics (both themes).
- [ ] Every control reachable and operable by keyboard, with a visible focus ring.
- [ ] Inputs have labels; icon-only buttons have `aria-label`.
- [ ] Live regions for streaming/async updates (search results, chat).
- [ ] No meaning conveyed by color alone (pair with icon/text).
- [ ] **List keyboard navigation.** All managed lists (`BookmarkList`, import result grid,
      vocabulary tabs) share `useListKeyboardNav`: `↑`/`↓` to move selection, `Enter`
      to activate, `Delete`/backspace to remove (grid: `←`/`→`, column-aware `↑`/`↓`, Home/End).
      Roving tabindex; `role="list"`/`role="listitem"` semantics.
- [ ] "Skip to results" link for screen-reader/keyboard users.
- [ ] Focus trap verified on every sheet (`BookmarkDetailSheet`, `AddBookmarkSheet`) and the
      `AlertDialog` triggered from within; focus restored on close.
- [ ] Verify `--muted-foreground` against `--background` in both themes; darken if below AA.

## Deferred UI/UX improvements (iteration 2)

1. ~~Card elevation/radius normalization~~ — done. `Card` and `CardFrame` use `rounded-lg`
   (`apps/web/src/components/ui/card.tsx:15,35`), table `variant="card"` uses `rounded-lg` corners
   (`apps/web/src/components/ui/table.tsx:64`), and the preview-rail card dropped `shadow-sm`
   (`apps/web/src/components/motion/preview-rail.tsx:53`). `TopbarSearch.tsx:46` mode toggle no
   longer uses `shadow-sm` on its static surface.
2. ~~Unify sidebar nav trees~~ — done. Active nav entries now share
   `sidebar-accent`/`sidebar-accent-foreground` in both expanded rows and the collapsed rail
   (`apps/web/src/components/Sidebar.tsx:69-72,397`), and counts render through the shared
   `NavCount` component (`apps/web/src/components/Sidebar.tsx:261,272,363-377,408`).
3. ~~Unify tag pill wrappers~~ — done. `TagItem` and `BookmarkTagPill` were removed;
   `FilterTagPill` (`apps/web/src/components/FilterTagPill.tsx:24`) is the single wrapper used in
   the sidebar tag list and bookmark card tag rows (`apps/web/src/components/Sidebar.tsx:331` and
   `apps/web/src/components/BookmarkList.tsx:258`).
4. Motion + empty-state pass — apply DESIGN.md motion tokens to sidebar collapse/sheet
   transitions; review empty/skeleton states against imagery fallback rules.
5. Batch operations — multi-select delete/tagging across managed lists (rows already share one
   action language; selection state and a batch mutation surface are the missing pieces).
6. Vocabulary pagination/virtualization — the vocab lists are unpaginated with a client-side
   filter; revisit if a dataset grows past ~500 entries per tab.
