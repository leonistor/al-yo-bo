# @coss/command (replaces dead cmdk wrapper)

2026-10-02, strategy: golden pair via CLI (`shadcn add @coss/command --overwrite`), verdict: adopted — coss ships a base-ui-native command palette using its `Autocomplete` primitive (from `@base-ui/react/autocomplete`) wrapped in a base-ui `Dialog`. The previous wrapper used `cmdk`, which the audit flagged as dead (zero callers in apps/web).

## Changed

| File | What |
|---|---|
| `command.tsx` | Full coss rewrite. Base-ui `Dialog` + base-ui `Autocomplete` (no cmdk). Public names: `CommandDialog`, `CommandDialogPortal`, `CommandDialogTrigger`, `CommandDialogBackdrop` (alias `CommandDialogOverlay`), `CommandDialogPopup` (alias `CommandDialogContent`), `CommandDialogHeader`, `CommandDialogFooter`, `CommandDialogTitle`, `CommandDialogDescription`, `CommandDialogClose`, plus `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandGroupLabel`, `CommandItem`, `CommandShortcut`, `CommandSeparator` — all built on the `Autocomplete` primitive. |
| `autocomplete.tsx` (new) | coss's `Autocomplete` primitive wrapper — base-ui's composable autocomplete. Used internally by `command.tsx`; can also be used standalone for non-dialog search fields. |
| `input.tsx` | coss variant pulled in (replaces ours with the coss base-ui Input — same public name). |
| `apps/web/package.json` | `cmdk@^1.1.1` removed (zero source consumers; only the dead wrapper used it). `bun.lock` updated accordingly. |

Per-file leftover scan: zero radix refs in all changed files. Zero cmdk refs anywhere in apps/web.

## Left alone

- The dead `command.tsx` consumers from the audit are still zero — the upgrade is a pure wrapper swap. The actual palette wiring (Phase 6 next action #2) lives in a follow-up.

## Behavior changes

- None for end users today (zero callers). When wired, the coss variant gives a keyboard-first palette out of the box (base-ui `Autocomplete` handles typeahead, keyboard nav, item selection).
- `cmdk` package is gone — smaller install footprint.

## Verify by hand

- n/a — no consumers yet. Smoke test in Phase 6 action #2 when the palette is wired (Cmd/Ctrl+K opens it, searches bookmarks + tags + actions).