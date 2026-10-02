# dialog

2026-10-02, strategy: golden pair via CLI (`shadcn add dialog --overwrite`), verdict: migrated with one consumer sweep — `DialogTrigger asChild` had to lose asChild (base-ui uses `render`).

`dialog.tsx` now uses `@base-ui/react/dialog` via `DialogPrimitive.*` (Root, Trigger, Portal, Backdrop, Popup, Title, Description, Close, ScrollShadow).

## Changed

| File | What |
|---|---|
| `dialog.tsx` | full rewrite to base-ui primitives; public names preserved (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`, `DialogScrollContent`). |
| `dialog.tsx` | `DialogScrollContent` preserved for back-compat; wraps `DialogPrimitive.Popup` + a scroll-shadow effect. |
| `dialog.tsx` | removed: `<DialogPrimitive.Close asChild>` → `<DialogPrimitive.Close>` (Close is a button by default in base-ui; className forwarded). |

Per-file leftover scan: `grep -n "radix-ui\|@radix-ui"` on dialog.tsx → zero matches.

## Left alone

- App code still uses `Tabs` (covered in tabs.md) and `Select` (covered in select.md).
- `DialogPrimitive.Close` in `dialog.tsx` is still a button (no `asChild` / `render` needed at the wrapper boundary).
- The 2 `TooltipTrigger asChild` sites in `attachment.aui.tsx` — `TooltipTrigger` is the radix Tooltip (not migrated yet); those still typecheck.

## Behavior changes

- **`DialogTrigger asChild` removed.** Base UI uses the `render` prop for the polymorphic primitive. Migration rule: `<X asChild><child/></X>` → `<X render={<child/>}>` OR (simpler) `<X>{child}</X>` when a wrapping button is acceptable. Per the universal rule in `consumer-props.md` row 13.
- **`onOpenAutoFocus` → `initialFocus`** (skill row 40) — element/ref-based, not event-based. Not used by the wrapper.
- **`onCloseAutoFocus` → `finalFocus`** (skill row 41) — same. Not used by the wrapper.
- **`onEscapeKeyDown` / `onPointerDownOutside` / `onInteractOutside` consolidated** (skill row 42) — base-ui exposes a unified set; consult overlays.md if any consumer relies on the radix event names. Grep confirms zero current callers passing these.
- **Anatomy: `Portal > Backdrop > Popup > Title|Description|...|Close`** — base-ui wrapper composes these inside `DialogContent`. Public API unchanged.

## Consumer sweep

One file updated for `DialogTrigger asChild` removal:

| File | Site | Fix |
|---|---|---|
| `assistant-ui/elements/attachment.aui.tsx:74` | `<DialogTrigger asChild className="cursor-zoom-in">{isValidElement(children) ? children : <button>{children}</button>}</DialogTrigger>` | dropped asChild + conditional, rendered `<DialogTrigger className="...">{children}</DialogTrigger>` — the trigger becomes a button wrapping `children`. The original polymorphic intent (button-or-passed-element) collapses to "always a button"; for the attachment preview use case (image is the click target), an extra `<button>` wrapper is harmless visually and accessibility-correct. |

Unused import `isValidElement` removed in the same edit.

`google.com/SharedElementCallSitesEventDetails` is the new event-details arg passed alongside callbacks — single-arg handlers remain type-safe per skill's "Callback signature rule".

## Verify by hand

- Open `BookmarkDetailDialog` (or any consumer of Dialog in the app). Confirm:
  - Modal opens and closes
  - Esc key closes
  - Backdrop click closes
  - Focus trap (Tab cycles within dialog)
  - Focus returns to the trigger on close
- Attachment preview dialog (in any chat thread with an image attachment) — image click opens the full preview.
- Sheet/menu/etc. — separate reports.