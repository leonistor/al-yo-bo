# tabs

2026-10-02, strategy: golden pair via CLI (`shadcn add tabs --overwrite`), verdict: migrated cleanly, no consumer sweeps required.

\`ts\`:tabs.tsx \`Tabs\` / \`TabsList\` / \`TabsTrigger\` / \`TabsContent\` now use \`@base-ui/react/tabs\` via \`TabsPrimitive.Root\` / \`.List\` / \`.Tab\` / \`.Panel\`. cva variant on the list (\`default\` / \`line\`) preserved. Per-skill note: \`TabsPrimitive.Tab\` replaces the Radix \`Tabs\`.Trigger\`; \`TabsPrimitive.Panel\` replaces \`Tabs\`.Content\` — public names (\`Tabs\`, \`TabsTrigger\`, \`TabsContent\`) preserved in the wrapper to keep app code untouched.

## Changed

| File | What |
|---|---|
| `tabs.tsx:1` | \`import { Tabs as TabsPrimitive } from "radix-ui"\` → \`import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"\` |
| `tabs.tsx:9-21` | Root: \`TabsPrimitive.Root.Props\` — unchanged API, \`orientation\` default \`horizontal\` preserved. |
| `tabs.tsx:23-36` | New \`tabsListVariants\` cva (\`variant: default\|line\`); list exposes \`variant\` prop. |
| `tabs.tsx:38-51` | \`TabsList\` → \`TabsPrimitive.List\` |
| `tabs.tsx:53-67` | \`TabsTrigger\` → \`TabsPrimitive.Tab\` (was Radix \`TabsTrigger\`) |
| `tabs.tsx:69-77` | \`TabsContent\` → \`TabsPrimitive.Panel\` (was Radix \`TabsContent\`) |

Per-file leftover scan: \`grep -n "radix-ui\|@radix-ui"\` on tabs.tsx → zero matches.

## Left alone

- All other components/ui files.
- The \`textarea\` shim was skipped by the add command (file already identical to base-nova golden) — the radix source never needed a base-ui primitive for it (it's a styled native \`<textarea>\`).

## Behavior changes

- \`Tabs\` activation defaults to MANUAL (no \`activationMode\` prop exists in base-ui Tabs). The skill flags this as a behavior delta — see \`consumer-props.md\` row 20. Grep confirms zero current usages of \`activationMode\` in app code; no migration action needed.
- \`Tabs.List activateOnFocus\` is a near-equivalent opt-in (opt-out per skill rule); not auto-applied.

## Verify by hand

- Tab switching via keyboard (arrow keys move focus, Space/Enter activates).
- Focus indicator on the active tab.
- Click to activate.
- \`orientation="vertical"\` if any caller uses it (grep below).
- \`variant="line"\` for the underline-style list variant.

Confirm no caller passed \`activationMode\` (grep result: zero matches).