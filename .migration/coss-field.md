# @coss/field (+ refactor 3 dialog forms)

2026-10-02, strategy: CLI add (`shadcn add @coss/field`) + markup refactor of the
three dialog forms, verdict: adopted — coss ships a thin base-ui `Field` port
(`@base-ui/react/field`: Root/Label/Item/Description/Error + Control/Validity
re-exports, no FieldGroup/FieldSet in this variant). The audit's "5 forms"
reduces to these 3 dialogs; ImportPage rows belong to the `@coss/table`
leftover and the Topbar search field to its own redesign item.

## Changed

| File | What |
|---|---|
| `ui/field.tsx` (new) | coss Field wrapper, verbatim. `destructive-foreground` CSS vars already existed in `index.css` (no CSS change needed). |
| `AddBookmarkDialog.tsx` | 4 fields (URL/Title/Note/Category) → `Field` composition. Inputs/Textarea via `FieldControl render={…}`; Category via explicit `FieldLabel htmlFor` + `SelectTrigger id`. Existing ids preserved (`add-url`, `add-title`, `add-description`, `add-category`). |
| `BookmarkDetailDialog.tsx` | Title/Note/Category + the Tags block under `Field` semantics. New ids: `detail-category` (was unlabeled), `detail-add-tag`; Tags label uses conditional `htmlFor` (no dangling `for` when the add-select is hidden). Invalid-link callout, HeaderImage, badges, delete flow untouched. |
| `VocabDialog.tsx` | 3 input(+select)+button clusters → `Field` + `FieldItem w-full gap-2` rows. Kept 3 explicit blocks (a helper needed too much conditional prop plumbing for rows that differ in Select presence/width/handlers). Ids preserved. |

## Behavior changes

- None. State, handlers, submit logic, toasts, disabled conditions, props are
  frozen; structure/semantics only. No react-hook-form/zod/<form> introduced
  (the app's per-field useState architecture is intentional).
- Labels now produce real a11y associations everywhere (previously plain
  `Label htmlFor` — equivalent, but base-ui adds `aria-labelledby` + focus
  state attributes where its wiring lands).

## Gotchas found in live smoke (fixed at call sites, wrapper untouched)

1. **Textarea + `FieldControl render`**: base-ui's generated id loses to the
   explicit DOM id, leaving a dangling `label[for]`. Fix: explicit `htmlFor`
   on the Note labels (`add-description`, `detail-description`). Inputs don't
   hit this because base-ui's `InputPrimitive` syncs its id back into the
   field context.
2. **`FieldItem` nesting breaks id sync**: in VocabDialog rows, the control
   got no `aria-labelledby` and the label emitted its generated id as `for`.
   Fix: explicit `htmlFor` on all three labels (`new-section`,
   `new-category`, `new-tag`).
3. `Field.Root` uses `items-start`; full-width children rely on their own
   `w-full` — `Input`/`Textarea`/`SelectTrigger` all carry it, VocabDialog
   rows override via `FieldItem w-full`.

## Verify by hand

- Live-smoked against the dev server: all 10 label/control pairs resolve in
  the a11y tree (`for` + `aria-labelledby`), Add-dialog Save gates on URL,
  Category select opens with options, screenshots match the previous visuals
  (gap rhythm 1.5 → 2 from the Field wrapper is the only delta).
- Known pre-existing quirk (not from this change): `SelectValue` shows the raw
  value (e.g. category UUID) until the popup opens once — adjacent to the
  outstanding "Tag assignment combobox" follow-up.
