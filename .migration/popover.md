# popover

2026-10-02, strategy: golden pair via CLI (`shadcn add popover --overwrite`), verdict: new wrapper, base-ui Popover primitives. Zero consumer sweeps required.

DESIGN.md:44-45 lists `popover` as a canonical building block. The repo's prior inventory showed popover not installed.

## Changed

| File | What |
|---|---|
| `popover.tsx` (new) | shadcn `popover.tsx` golden — uses `@base-ui/react/popover` via `PopoverPrimitive.*` (Root, Trigger, Portal, Backdrop, Positioner, Popup, Title, Description, Arrow). Public names: `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverHeader`, `PopoverTitle`, `PopoverDescription`, `PopoverClose`. |

Per-file leftover scan: zero radix refs.

## Left alone

- App code — no callers yet.
- All other ui/ files.

## Behavior changes

- Per `consumer-props.md` rows 39: `openDelay`/`closeDelay` on Root are dropped in base-ui Popover; the equivalents move to `Trigger` as `delay`/`closeDelay`. The shadcn base-nova wrapper handles this internally; consumers don't need to pass anything.
- `PopoverArrow` preserved as a wrapper around the base-ui primitive.

## Verify by hand

- n/a — no consumers yet. Smoke test in a follow-up when the first popover is added (Phase 6 work).