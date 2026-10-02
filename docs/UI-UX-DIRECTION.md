# al-yo-bo UI/UX Direction (post base-ui migration)

> Companion to `docs/DESIGN.md`. Captures the audit, direction, and next actions taken
> after the base-ui migration + coss/beui registry wiring. Refresh this document when
> the direction shifts; DESIGN.md stays the single-source-of-truth for tokens and rules.

## 1. Current UI audit

**Architecture and shell.** `App.tsx:392` builds a classic three-zone shell:
persistent left rail (`Sidebar.tsx`), top bar (`Topbar.tsx`), main content area that
swaps between the library, review queue, and import views. The right-hand chat panel
is conditionally rendered inside `main` at `App.tsx:494` as a fixed `24rem` column on
`md+` and as a full-screen sheet below.

**Visual hierarchy today is flat.** Everything competes at roughly the same optical weight:
- No page title or breadcrumb; the only way to know where you are is the subtle
  active state in the sidebar (`Sidebar.tsx:161`).
- `Topbar.tsx:84` crams search, mode select, import, add, chat, theme, and profile
  into one row.
- Bookmark cards use the same `text-sm` body, `text-xs` metadata, and muted secondary
  badges everywhere. There is no deliberate "read this first, then this" rhythm.
- Color is almost entirely neutral: a blue-ish primary (`index.css:75`) against zinc
  grays. Cohesive but visually quiet.

**Motion is present but scattered.** Dialogs and sheets animate; the library list has
no entrance motion, pagination swaps pages instantly, and chat has the richest motion
(inherited from assistant-ui).

**Interaction patterns are functional but generic.** Search is a plain input with a
mode select — no command-palette surface, no recent searches, no scoped tag/category
quick filters. `BookmarkDetailDialog` is dense; editing tags uses a `<select>` as an
action trigger (`BookmarkDetailDialog.tsx:393-410`) — works but expresses better as a
combobox or menu.

**Accessibility is mostly there but uneven.**
- Keyboard shortcuts exist (`/`, `c`, `Esc`) but the bookmark list has no `listbox` /
  arrow-key selection — keyboard users tab through every card.
- Empty states are designed (`BookmarkList.tsx:228`, `ImportPage.tsx:322`).
- `--muted-foreground` against `--background` may be near the AA boundary in light
  theme — verify and darken if needed.

**Where DESIGN.md was out of date (now refreshed).**
- §Components said "shadcn/ui + Radix" — all wrappers are now `@base-ui/react`
  (`base-nova`).
- §Chat said "assistant-ui primitives" — Phase 5 replaces with beui.dev.
- §Interaction & motion lacked timing tokens — now standardized at
  150 / 200 / 250-300 ms.

## 2. Direction

### Information hierarchy — what pops, what recedes

**Give the current view a voice.** Above `ResultsToolbar.tsx`, add:
- A `text-xs` uppercase section label ("Library", "Review queue", "Import") in
  `muted-foreground`.
- The active filter state as a single sentence: e.g.
  "312 bookmarks · active · tagged **AI**".

**Make the search bar the hero of the top bar.** Consolidate import/add/chat into a
single "Create" split-button (`Add` + dropdown for `Import`) on the right. Move theme
and profile into a single account menu at the far right. Keep the search input
centered/flexed with the mode toggle as a compact segmented control attached to it.
Result: ~8 visual items → ~4.

**Recast the bookmark card.**
- Title: `text-sm font-medium text-foreground`.
- Host + date combined on one `text-xs text-muted-foreground` line.
- Description: `line-clamp-2`, `text-sm text-foreground/80`.
- Tags below description in a softer badge style (`variant="outline"` or a custom
  `tag` variant).
- Row actions (open, delete) only exposed on hover/focus-within; visible focus path
  for keyboard reach.

**Distinguish the review queue.** `ClassifierSuggestions` should not look like the
library list. Denser table-like row, confidence indicator (subtle progress bar or
dot scale), explicit "Accept" as primary action.

### Motion language

- **Page entrance.** Stagger toolbar, result count, cards over `200 ms` ease-out.
  `translate-y-1 → 0`, opacity `0 → 1`. Respect `prefers-reduced-motion`.
- **Pagination.** Crossfade the list `150 ms` and scroll the list container to top.
- **Filter changes.** Brief `opacity-70` pulse on the result count + inline spinner;
  avoid full-screen skeleton flashes.
- **Card hover.** Existing `hover:bg-accent/50` + `transition-colors duration-150`.
- **Sidebar selection.** Slide the active indicator as a background pill, not an
  instant background swap.
- **Chat open/close.** Animate the main-column width change so the list and chat
  share a graceful resize.

**Timing tokens** (recorded in DESIGN.md §Interaction & motion):

| ms    | use                                              |
|-------|--------------------------------------------------|
| 150   | hover/press feedback, link transitions           |
| 200   | state changes (mode, layout, filter, backdrop)   |
| 250–300 | panel/sheet entrances, command palette         |

Easing: `ease-out` for entrances, `ease-in-out` for layout resizes.

### Interaction upgrades

- **Toggle-group primitive** for status/layout/mode toggles (beui/coss registries
  may ship one) — keyboard arrow navigation + moving selection indicator.
- **Search-mode badge** — first-encountered tooltip explaining the current mode.
- **Command palette** — `Cmd/Ctrl+K` opens a modal combining search, category/tag
  jumps, and recent queries. The existing `ui/command.tsx` (cmdk) wrapper is the
  starting point; the `@coss/command` primitive is the longer-term replacement.
- **Tag assignment** — replace the `<select>` in `BookmarkDetailDialog.tsx:382`
  with a searchable combobox that supports inline creation.
- **Import page bento summary** — parsed count, skipped count, duplicates,
  categories-to-be-created using coss stat cards.

### Page-level recommendations

| Page/Surface         | Biggest opportunity                          | Registry/component idea              |
|---------------------|------------------------------------------|-------------------------------------|
| Library list        | Reading rhythm + keyboard selection     | Custom list; beui `animated-list`  |
| Bookmark detail     | Form hierarchy + tag assignment        | coss/beui `combobox`                |
| Review queue        | Decision-oriented layout                | Table-like rows + confidence bars   |
| Import page         | Visual summary + editable rows          | coss `stat-card`, beui `resizable`  |
| Top bar / nav       | Reduce visual load + command palette    | beui `command-menu`                 |
| Chat panel          | Cohesive thread primitives              | beui.dev thread/composer            |

### Accessibility upgrades

- **List keyboard navigation.** Roving tabindex + `role="listbox"` for
  `BookmarkList.tsx`; arrows move selection, Enter opens detail, Delete removes.
- **Skip link** for screen-reader/keyboard users.
- **Focus trap audit** on every dialog (the nested `AlertDialog` inside
  `BookmarkDetailDialog` is the trickiest).
- **Live regions** for filter changes + chat tool-call status (the result count
  already uses `aria-live="polite"` — extend).
- **Color independence** — never use red alone for state (already true: invalid
  badge pairs with text).
- **Contrast check** — `--muted-foreground` against `--background` in both themes.

### Honoring DESIGN.md

§Components, §Interaction & motion, §Chat, and §Accessibility are updated in
DESIGN.md to reflect the base-ui + coss/beui + beui-chat reality.

## 3. Concrete next actions

1. **Phase 6** (this document + DESIGN.md refresh) — done.
2. **Phase 4** — adopt high-value coss.com/ui components (forms via `@coss/field`,
   `@coss/dialog`, `@coss/sheet`, `@coss/alert-dialog`, `@coss/card`,
   `@coss/empty`, `@coss/table` for ImportPage, `@coss/command` to replace the
   dead `ui/command.tsx`).
3. **Phase 5** — done (commit 1c4dace). Chat surface rebuilt on beui
   primitives (`message`, `prompt-input`, `streaming-response`,
   `agent-activity`); `@assistant-ui/*` and `radix-ui` dropped.
4. **List keyboard navigation** — `BookmarkList.tsx` roving tabindex + arrows.
5. **Top bar redesign** — search-hero layout with consolidated Create + account
   menus.
6. **Library entrance + pagination crossfade** motion.
7. **Tag assignment combobox** in `BookmarkDetailDialog`.

## 4. What NOT to do

- **Do not chase a flashy "landing page" aesthetic.** al-yo-bo is a daily-use
  developer tool; calm + dense + keyboard-first wins over visual spectacle.
- **Do not introduce theme branching in components.** Tokens already handle
  light/dark; consume semantic colors only.
- **Do not swap Work Sans for a generic sans.** If a display font is added for
  headings, keep Work Sans for body UI.
- **Do not adopt Grimoire out-of-scope features.** Domains, Timeline, Archive,
  Suggestions, pin/read-later counters (DESIGN.md:77) stay out.
- **Do not animate everything.** One entrance stagger + one layout resize is
  enough; avoid hover-jiggle on every button.
- **Do not remove accessible behaviors to make it "cleaner."** Visible focus
  rings, `aria-live` regions, and keyboard shortcuts are non-negotiable.
- **Do not pull heavy animation libraries for effects Tailwind can already do.**
  Default to Tailwind transitions/keyframes; drop to custom CSS/JS only for the
  sliding sidebar indicator or layout panel resize.