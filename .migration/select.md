# select

2026-10-02, strategy: golden pair via CLI (`shadcn add select --overwrite`), verdict: migrated with significant consumer sweep — `onValueChange` callback signature widened.

`select.tsx` now uses `@base-ui/react/select` via `SelectPrimitive.*` (Root, Trigger, Value, Icon, Portal, Backdrop, Positioner, Popup, List, Item, ItemText, ScrollUpArrow, ScrollDownArrow, Arrow, Group, GroupLabel, Separator).

## Changed

| File | What |
|---|---|
| `select.tsx` | full rewrite to base-ui primitives; names preserved (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, etc.). |
| `select.tsx` | cva variants on `<Select>` (sizes: default, xs, lg) — implicit. |
| `select.tsx` | removed: `<SelectPrimitive.Icon asChild>` → `<SelectPrimitive.Icon>` (Icon no longer wraps a child; renders the chevron icon directly via lucide). |
| `select.tsx` | `SelectScrollUpButton`/`SelectScrollDownButton` → `ScrollUpArrow`/`ScrollDownArrow` (renamed per skill). Wrapper names `SelectScrollUpButton`/`SelectScrollDownButton` preserved for back-compat. |

Per-file leftover scan: `grep -n "radix-ui\|@radix-ui"` on select.tsx → zero matches.

## Left alone

- App code uses `Tabs` (different signature change in tabs.md).
- `sonner.tsx`, `spinner.tsx`, `empty.tsx`, `card.tsx`, `skeleton.tsx` — non-radix / native; unrelated.

## Behavior changes

- **`Select onValueChange(value: string)` → `onValueChange(value: string \| null, eventDetails: SelectRootChangeEventDetails)`** — per `consumer-props.md` row 29. Callers passing `useState<string>` setters must either widen state to `string | null` or wrap the setter with a null-coalescing fallback. Handlers typed `(value: string) => ...` must widen to `(value: string \| null)` and guard against null (or default to a known string).
- **`position="popper"|"item-aligned"` → `alignItemWithTrigger`** (skill row 21) — grep confirms zero current callers passing `position` directly; the base-ui shadcn wrapper handles the default.
- **`onOpenChange` + `onValueChange` add event-details arg** — skill "Callback signature rule" applies. Existing single-arg handlers stay type-safe via widening.
- **Items-first pattern** — base-ui Select requires `<Select.Item value="">` items (already the project's pattern). No migration needed for value shape.
- **`Portal > Positioner > Popup` anatomy** — base-ui wrapper composes these inside `SelectContent`. Public API unchanged.

## Consumer sweep

Six files updated; all `onValueChange` callbacks either widened or wrapped:

| File | Site | Fix |
|---|---|---|
| `Topbar.tsx:107` (`handleModeChange`) | Tabs/Select | widened `(value: string) => onModeChange(value as SearchMode)` to `(value: string \| null) => { if (value) onModeChange(value as SearchMode); }` |
| `ResultsToolbar.tsx:98` (`handleSortChange`) | Select | widened to `string \| null`, null guard |
| `ResultsToolbar.tsx:111` (`handleDirectionChange`) | Select | widened to `string \| null`, null guard |
| `VocabDialog.tsx:140` (`setCategorySectionId`) | Select | `useState<string>` setter wrapped inline: `(v) => setCategorySectionId(v ?? 'none')` |
| `VocabDialog.tsx:173` (`setTagCategoryId`) | Select | wrapped: `(v) => setTagCategoryId(v ?? 'none')` |
| `BookmarkDetailDialog.tsx:361` (`setCategoryId`) | Select | wrapped: `(v) => setCategoryId(v ?? 'none')` |
| `BookmarkDetailDialog.tsx:389` (`addTag`) | Select | widened async handler to `(tagId: string \| null)`, no-op if null |
| `AddBookmarkDialog.tsx:118` (`setCategoryId`) | Select | wrapped: `(v) => setCategoryId(v ?? 'none')` |
| `ImportPage.tsx:211` (`selectSourceTab`) | **Tabs** | widened to `string \| null`, null guard (also fixed by the Tabs signature change) |

## Verify by hand

- Open any Select (Topbar search-mode, ResultsToolbar sort/direction, Vocab/Bookmark dialog category selectors). Confirm:
  - Default selection renders
  - Keyboard nav (arrow keys, Enter, Esc)
  - Typeahead (typing a letter jumps to matching item)
  - Clear/null behavior — none of the current selects have a null option; if you click "No category", the wrapped setter coerces to `'none'`.
- Each Select opens/closes without console warnings about the new event details arg.
- Compare layout and motion vs. the previous radix version.