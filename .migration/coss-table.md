# @coss/table — ImportPage right pane

2026-10-02, strategy: adopt the freshly-installed `@coss/table` wrapper for the
import result list, verdict: adopted — card variant matches the existing
mini-card rows and the bordered-pane aesthetic while giving us proper table
semantics and a sticky header.

## Changed

| File | What |
|---|---|
| `apps/web/src/components/ImportPage.tsx` | Right-pane row list replaced with `<Table variant="card" className="min-w-[44rem]">` inside the existing `ScrollArea`. Added a `<TableHeader>` with columns: Include (sr-only), Bookmark, Category, Priority, Tags, Remove (sr-only). Skeleton and empty states untouched; left pane, header badge, duplicate-URL hint, and sticky commit bar untouched. |
| `apps/web/src/components/ImportRow.tsx` | Rewrote from a flex card to a `memo` `<TableRow>` with `<TableCell>` cells. Title/URL/description stack in the first cell; Category, Priority (centered, `w-12`), Tags, and Remove each have their own cell. Kept per-field stable handlers, `fieldClass` borderless inputs, `aria-label`s, disabled-when-excluded, and the 50% opacity exclusion treatment. |
| `docs/DESIGN.md` | Updated the Import page right-pane bullet to describe the new table anatomy (`variant="card"`, header columns, horizontal scroll, stacked Bookmark cell). |

## Behavior changes

- None. State, `toImportedBookmark`/`toRow`, handlers, toasts, disabled
  conditions, memoization contract, and a11y labels are frozen; only markup
  semantics and layout changed.
- No react-hook-form/zod/`<form>` introduced; per-field `useState` stays.

## Gotchas found in the wrapper (call-site workarounds, wrapper untouched)

1. **`TableCell` defaults to `whitespace-nowrap`.** The stacked Bookmark cell
   (title input, URL span, description input) needs `whitespace-normal` so the
   row can grow vertically; the other cells keep nowrap because their inputs
   scroll horizontally when constrained.
2. **`has-[[role=checkbox]]` width helpers.** The wrapper auto-squeezes cells
   that contain a checkbox and strips their padding. The include column relies
   on this; we didn't fight it. For header columns that only contain an
   `sr-only` label, the helper doesn't match, so we explicitly set `w-px`.
3. **Card variant borders are `border-separate`.** The rounded-card look comes
   from `TableBody`'s complex `in-data-[variant=card]` selectors; we didn't add
   extra borders or padding beyond the existing `p-3` wrapper.
4. **Focus rings remain visible.** Inputs use the existing `fieldClass`
   (`border-transparent` → `focus-visible:border-input`) inside `TableCell`
   `p-2.5`; the `overflow-x-auto` table container does not clip focus rings.
5. **Horizontal scroll on narrow viewports.** All editable columns stay
   accessible at every breakpoint; `min-w-[44rem]` on the table forces the
   container's `overflow-x-auto` to kick in below that width rather than
   squashing cells.

## Verify by hand

- Extract a collection; confirm the right pane renders a card-style table with
  headers, not the old stacked cards.
- Edit a title in one row; confirm sibling rows do not re-render (React DevTools
  Profiler, or watch for no flicker/scroll jump).
- Exclude a row: checkbox toggles, row dims to 50% opacity, inputs disable, row
  stays in place, included/total badge updates.
- Remove a row: it disappears, badge and duplicate-URL hint update.
- Priority field is centered, accepts numeric input, and stays narrow.
- Resize viewport below `md` (stacked panes) and below the table min-width:
  vertical scrolling still works via `ScrollArea`, horizontal scrolling appears
  for the table, focus rings are not clipped.
- Screen-reader/inspector: every editable input still has an accessible label
  (`aria-label`); column headers are real `<th scope="col">` elements.
