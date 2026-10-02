# sheet

2026-10-02, strategy: golden pair via CLI (`shadcn add sheet --overwrite`), verdict: migrated cleanly, no consumer sweeps required.

`sheet.tsx` now uses `@base-ui/react/dialog` (sheet is a styled dialog in base-ui, same primitive set). The migration is the closest thing to a "rename + render-prop swap" in the whole project.

## Changed

| File | What |
|---|---|
| `sheet.tsx:2` | `import { Dialog as SheetPrimitive } from "@radix-ui/react-dialog"` → `import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"` |
| `sheet.tsx:60-74` | close-button composition: was `<SheetPrimitive.Close data-slot="sheet-close" asChild>` wrapping a hand-styled X button — now `<SheetPrimitive.Close render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}>` — the render prop on base-ui's Close. ClassName is on the rendered Button, not on Close. |

Per-file leftover scan: `grep -n "radix-ui\|@radix-ui"` on sheet.tsx → zero matches.

## Left alone

- `sheet.tsx` public names (`Sheet`, `SheetTrigger`, `SheetClose`, `SheetPortal`, `SheetOverlay`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`) all preserved.
- All app callers (`grep -rn "from.*sheet"`) — none pass asChild directly to a sheet wrapper export.

## Behavior changes

- None for the project's existing consumers — the close button composition is internal to the wrapper and visually identical.
- Sheet's `side` prop default unchanged (`right`).
- Animation defaults preserved (CSS classes in the wrapper).

## Verify by hand

- Open any sheet (Sidebar narrow viewport, any consumer). Confirm:
  - Sheet slides in from the right (or chosen side)
  - Esc closes, backdrop click closes, focus trap works
  - X button (top-right) closes
  - Focus returns to the trigger on close