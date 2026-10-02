# @coss/sheet

2026-10-02, strategy: golden pair via CLI (`shadcn add @coss/sheet --overwrite`), verdict: adopted — coss's sheet ecosystem pulls in a richer button + spinner + scroll-area family. Significant wrapper upgrades; no consumer breaks (typecheck clean across all apps/web workspaces).

`@coss/sheet` is more than a sheet — it ships the production-tuned coss **button**, **spinner**, **scroll-area**, and **sheet** as one wrapper family. The CLI overwrote all four (sheet's transitive deps).

## Changed

| File | What |
|---|---|
| `button.tsx` | Switched from `ButtonPrimitive` (`@base-ui/react/button`) to `useRender` (`@base-ui/react/use-render`) + `mergeProps`. New variants: `destructive-outline`, `xl` size. New prop: `loading` (renders the coss Spinner in place of children, sets `data-loading`). `data-pressed` state attribute. Improved focus / disabled / `aria-invalid` handling (inset shadow, larger touch targets via `pointer-coarse`). Public exports preserved: `Button`, `buttonVariants`. |
| `sheet.tsx` | Full rewrite to coss sheet: composes `Dialog` primitives with `cva`-varied `SheetContent` (side: top/bottom/left/right, variant: default, showCloseButton). Public names preserved. |
| `scroll-area.tsx` | coss variant — base-ui ScrollArea + cva variants. |
| `spinner.tsx` | Named export, accepts `Loader2Icon` props (dropped the forced `size-4` — caller controls). `cn` import moved to `@/lib/utils` alias (project convention). |
| `src/index.css` | Added `--color-destructive-foreground` (mapped to `--destructive-foreground`) for light and dark themes (coss button uses it for `destructive-outline`). |

Per-file leftover scan: zero radix refs across all five files.

## Left alone

- All app code that imports `Button` from `@/components/ui/button` — unchanged.
- All alert-dialog and dialog consumers — separate wrappers (not pulled in by `@coss/sheet`).

## Behavior changes

- **Buttons have a `loading` prop.** New ergonomic — `<Button loading>...</Button>` shows the Spinner and hides children. Existing call sites don't pass it; zero current consumers, but available.
- **Buttons are visually richer** (inset shadows, larger default size `h-9`, larger touch targets). Visual delta: button shapes/weights shift slightly. Review in browser smoke.
- **Spinner is no longer fixed `size-4`** — caller controls via className. Default is whatever `<Loader2Icon>` renders.
- **`destructive-outline` button variant** — new; not used yet.

## Verify by hand

- Browse the library list, results toolbar, sidebar nav — buttons should render and feel slightly larger/cleaner (new default size `h-9`).
- Open and close every dialog/sheet — backdrop fade and slide should be smooth.
- The trigger close buttons in sheets should still work.

Browser smoke: `bun run browser:start` (Playwriter per DESIGN.md §Action).