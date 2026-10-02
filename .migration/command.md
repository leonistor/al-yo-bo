# command + input-group

2026-10-02, strategy: golden pair via CLI (`shadcn add command --overwrite`), verdict: added two new wrapper files. No existing components changed; no consumer sweeps required.

DESIGN.md:44-45 lists `command` and `popover` as canonical building blocks. The repo's prior inventory (`bunx shadcn info`) showed neither installed. `command` was the user's gap; `popover` follows in a separate report.

## Changed

| File | What |
|---|---|---|
| `command.tsx` (new) | shadcn `command.tsx` golden — wraps `cmdk` (NOT radix; per the skill rule "NEVER touch non-radix libraries or their wrappers: cmdk") inside a base-ui `Dialog` (the project's migrated dialog.tsx) for the modal command palette variant. Public names: `Command`, `CommandDialog`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandShortcut`, `CommandSeparator`. |
| `input-group.tsx` (new) | shadcn `input-group.tsx` golden — composite of `InputGroup`, `InputGroupAddon` (align: inline-start/inline-end/block-start/block-end), `InputGroupInput`, `InputGroupTextarea`, `InputGroupButton`. Plain HTML + cva + the project's `Button`/`Input`/`Textarea` wrappers. |

`cmdk` was installed as a transitive dep by the CLI (visible in `bun.lock`).

Per-file leftover scan: zero radix refs in both new files.

## Left alone

- App code — no callers yet (DESIGN.md canonical, but no UI uses them yet).
- All other ui/ files.

## Behavior changes

- None. command.tsx uses the already-migrated Dialog for the overlay; cmdk behavior is unchanged (it's never been radix).
- input-group.tsx is a styling/structural wrapper only.

## Verify by hand

- n/a — no consumers yet. Smoke test in a follow-up when the first command menu or popover is added.

Note: command palette wiring (keyboard shortcut, search data source) is Phase 6 work.