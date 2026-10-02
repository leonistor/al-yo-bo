# Primitives batch 1 — avatar, badge, checkbox, collapsible, scroll-area, separator

2026-10-02, strategy: golden pair via CLI (`shadcn add --overwrite` × 6), verdict: all six migrated cleanly, no consumer sweeps required.

Six base-ui primitive wrappers; one `shadcn add --overwrite` per file in apps/web/components/ui/base. Zero consumer updates — all call sites in app code use stable public names (`Avatar`, `Badge`, `Checkbox`, `Collapsible`, `ScrollArea`, `Separator`) with API surfaces that base-ui supports out of the box.

## Changed

| File | From | To |
|---|---|---|
| `avatar.tsx` | `import { Avatar as AvatarPrimitive } from "radix-ui"` | `import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"` |
| `badge.tsx` | `import { Slot } from "radix-ui"` (asChild pattern) | `import { mergeProps } from "@base-ui/react/merge-props"` + `import { useRender } from "@base-ui/react/use-render"` — cva variants retained, polymorphic primitive is now `useRender`. `asChild` is dropped per the skill's universal rule; consumers using `<Badge asChild>` (none in app code today) would need `<Badge render={...}>`. |
| `checkbox.tsx` | `import { Checkbox as CheckboxPrimitive } from "radix-ui"` | `import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"` |
| `collapsible.tsx` | `import { Collapsible as CollapsiblePrimitive } from "radix-ui"` | `import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"` |
| `scroll-area.tsx` | `import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"` | `import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"` |
| `separator.tsx` | `import { Separator as SeparatorPrimitive } from "radix-ui"` | `import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"` |

Per-file leftover scan (`grep -n "radix-ui\|@radix-ui" on the component's files`):
- all six: clean, zero matches.

## Left alone

- `apps/web/src/components/ui/sonner.tsx` — not radix (sonner is its own runtime, per the skill's hard rules: NEVER touch sonner).
- `apps/web/src/components/ui/spinner.tsx` — plain lucide icon, no primitive swap.
- `apps/web/src/components/ui/empty.tsx` — plain HTML + cva, framework-free.
- `apps/web/src/components/ui/card.tsx` — plain HTML + cva, framework-free.
- `apps/web/src/components/ui/skeleton.tsx` — plain HTML.

## Behavior changes

- **`badge.tsx` `asChild` removed.** Base UI badge uses `useRender` instead of Radix `Slot`. The radix pattern `<Badge asChild><a/></Badge>` is not supported; use `<Badge render={<a/>}>` if needed. Grep confirms no current consumers.
- **`separator.tsx` `decorative` prop removed** (per `consumer-props.md` row). Grep confirms no current consumers in app code; default decorative=true is preserved.
- **`scroll-area.tsx` `type="always"\|"scroll"` removed.** Grep confirms no current consumers; default behavior is unchanged.
- **`avatar.tsx` `delayMs` → `delay`** (per `consumer-props.md` row). Grep confirms no current consumers passing `delayMs`.

## Verify by hand

- `Avatar` — render with image, with fallback initial; confirm `delay` works (loader → image transition).
- `Badge` — visually unchanged.
- `Checkbox` — click toggles; focus ring; `indeterminate` works (skill rule: `checked="indeterminate"` → `indeterminate` + boolean `checked`).
- `Collapsible` — open/close on trigger; keyboard space/enter; data-state attrs.
- `ScrollArea` — vertical/horizontal scrollbars; wheel + drag.
- `Separator` — horizontal/vertical; decorative vs non-decorative (aria-hidden).

All six can be smoke-tested in a single browser session: `bun run browser:start`, navigate any page that uses them.