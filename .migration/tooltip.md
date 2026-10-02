# tooltip

2026-10-02, strategy: golden pair via CLI (`shadcn add tooltip --overwrite`), verdict: migrated with three consumer sweeps — `TooltipTrigger asChild` removed; `TooltipProvider delayDuration` renamed to `delay`.

`tooltip.tsx` now uses `@base-ui/react/tooltip` via `TooltipPrimitive.*` (Provider, Root, Trigger, Portal, Positioner, Popup, Arrow, Tip).

## Changed

| File | What |
|---|---|
| `tooltip.tsx` | full rewrite to base-ui primitives; public names preserved (`Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`, `TooltipArrow`). |
| `tooltip.tsx` | `TooltipProvider` props follow `consumer-props.md` row 22: `delayDuration` → `delay`, `skipDelayDuration` removed (no base-ui equivalent). |

Per-file leftover scan: `grep -n "radix-ui\|@radix-ui"` on tooltip.tsx → zero matches.

## Left alone

- The 2 `TooltipTrigger asChild` sites in `assistant-ui/elements/thread.aui.tsx` and `assistant-ui/elements/attachment.aui.tsx` that import from the radix-named imports (`TooltipProvider, TooltipTrigger from "@radix-ui/react-tooltip"`) are not the project's wrapper — they're assistant-ui internals; we keep those on radix per the partial plan.

Actually re-check: `attachment.aui.tsx` imports `TooltipProvider, TooltipTrigger` from `@/components/ui/tooltip` (project wrapper), so this site is the wrapper and was swept.

## Behavior changes

- **`TooltipProvider delayDuration` → `delay`** (skill row 22); `skipDelayDuration` dropped.
- **`Tooltip disableHoverableContent`** — no equivalent (skill row 23, flag). Grep: zero current callers passing it.
- **`TooltipTrigger asChild` → `render`** (universal rule); three consumer sites updated.

## Consumer sweep

| File | Site | Fix |
|---|---|---|
| `Sidebar.tsx:276` | `<TooltipTrigger asChild><Button ...>{children + badge}</Button></TooltipTrigger>` | `<TooltipTrigger render={<Button ... />}>{children + badge}</TooltipTrigger>` — render-prop polymorphic primitive; children pass through to the rendered Button. |
| `assistant-ui/elements/attachment.aui.tsx:158` | `<TooltipTrigger asChild><div role="button" ...>{AttachmentThumb + loading/error overlays}</div></TooltipTrigger>` | `<TooltipTrigger render={<div ... />}>` with the div's complex props (className, tabIndex, onKeyDown, onKeyUp, aria-label) on the render target and the children (AttachmentThumb, overlays) passed through. |
| `assistant-ui/elements/tooltip-icon-button.tsx:25,27` | `<TooltipProvider delayDuration={0}>` + `<TooltipTrigger asChild><Button>{Slot.Slottable>{children}}</Slot.Slottable><span>{tooltip}</span></Button></TooltipTrigger>` | `<TooltipProvider delay={0}>` + `<TooltipTrigger render={<Button .../>}>{children}<span>{tooltip}</span></TooltipTrigger>`. Dropped the `Slot` import (radix `Slot.Slottable` was only needed by the old `<Button asChild>` polymorphism). |

## Verify by hand

- Sidebar nav items: hover an item, the tooltip should show after the default delay. Tooltip should dismiss on hover-out.
- Chat composer-attachment tiles (the attachment.aui.tsx sites): hover shows the attachment name; keyboard navigation (Enter/Space) still works on the tile.
- `TooltipIconButton` (used by assistant-ui action bar buttons — copy, edit, reload, etc.): hover shows the tooltip; instant (`delay={0}`) is preserved.
- Esc key closes any open tooltip.