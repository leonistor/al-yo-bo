# @coss/alert-dialog

2026-10-02, strategy: golden pair via CLI (`shadcn add @coss/alert-dialog --overwrite`), verdict: migrated with two consumer sweeps — `AlertDialogAction` / `AlertDialogCancel` consolidated into a single `AlertDialogClose` with buttonVariants applied per-role.

The coss wrapper is base-ui-aligned and uses only `AlertDialogClose` (no separate Action / Cancel). The base-ui AlertDialog primitive has a single Close role; the project-specific styling (destructive for Action, outline for Cancel) is applied via `buttonVariants` at the call site.

## Changed

| File | What |
|---|---|
| `alert-dialog.tsx` | Full coss rewrite. Public names: `AlertDialog`, `AlertDialogTrigger`, `AlertDialogBackdrop` (alias `AlertDialogOverlay`), `AlertDialogPopup` (alias `AlertDialogContent`), `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogClose`, `AlertDialogPortal`, `AlertDialogViewport`. **`AlertDialogAction` and `AlertDialogCancel` are gone** — use `AlertDialogClose` + `buttonVariants` per-role. |

Per-file leftover scan: zero radix refs.

## Consumer sweep

| File | Site | Fix |
|---|---|---|
| `App.tsx:25-26, 543-544` | `<AlertDialogCancel>` and `<AlertDialogAction onClick={onDeleteConfirmed}>` | `<AlertDialogClose className={cn(buttonVariants({ variant: "outline" }))}>Cancel</AlertDialogClose>` + `<AlertDialogClose onClick={onDeleteConfirmed} className={cn(buttonVariants({ variant: "destructive" }))}>Delete</AlertDialogClose>` |
| `BookmarkDetailDialog.tsx:15-16, 428-429` | same pattern | same fix |

Imports updated in both — `AlertDialogAction`/`AlertDialogCancel` removed; `AlertDialogClose` added; `buttonVariants` and `cn` (from `@/lib/utils`) added.

## Behavior changes

- None functionally — both buttons still close the dialog (Close primitive) and the destructive one still runs the delete handler.
- Visual: more polish on the coss button variants (the @coss/sheet adoption already moved button.tsx to the coss render + cva pair).

## Verify by hand

- Open any delete confirmation (bookmark detail, library toolbar). Confirm:
  - Cancel button is outline, closes without action
  - Delete button is destructive (red), fires the delete + closes
- Keyboard: Tab cycles between Cancel and Delete, Enter triggers.