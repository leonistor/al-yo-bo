# alert-dialog

2026-10-02, strategy: golden pair via CLI (`shadcn add alert-dialog --overwrite`), verdict: migrated with one consumer sweep — `<AlertDialogTrigger asChild>` removed.

`alert-dialog.tsx` now uses `@base-ui/react/alert-dialog` via `AlertDialogPrimitive.*` (Root, Trigger, Portal, Backdrop, Popup, Title, Description, Action, Cancel).

## Changed

| File | What |
|---|---|
| `alert-dialog.tsx` | full rewrite to base-ui primitives; public names preserved. |
| `alert-dialog.tsx` | `AlertDialogAction`/`AlertDialogCancel` already had their `<Button asChild>` wrappers dropped earlier (Phase 3 button migration); they apply `buttonVariants({ variant, size })` directly via className. The new base-ui primitive code matches that shape. |

Per-file leftover scan: `grep -n "radix-ui\|@radix-ui"` on alert-dialog.tsx → zero matches.

## Left alone

- `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` — public names preserved.

## Behavior changes

- Same as `dialog.md` (base-ui shares primitive patterns with the regular dialog): `onOpenAutoFocus → initialFocus`, `onCloseAutoFocus → finalFocus`, event-handler consolidation. Grep confirms zero callers.
- `<AlertDialogTrigger asChild>` → render — universal rule. One consumer site updated.

## Consumer sweep

| File | Site | Fix |
|---|---|---|
| `BookmarkDetailDialog.tsx:416` | `<AlertDialogTrigger asChild><Button variant="destructive">Trash2Icon + Delete</Button></AlertDialogTrigger>` | `<AlertDialogTrigger render={<Button variant="destructive" />}><Trash2Icon + Delete</AlertDialogTrigger>` |

## Verify by hand

- Open any bookmark detail dialog → click "Delete" → confirm dialog appears
- Confirm/Cancel buttons work (use `buttonVariants` styling — destructive for Action, outline for Cancel)
- Esc closes, focus trap works, focus returns on close