# dropdown-menu

2026-10-02, strategy: golden pair via CLI (`shadcn add dropdown-menu --overwrite`), verdict: migrated with one consumer sweep — `<DropdownMenuTrigger asChild>` removed.

`dropdown-menu.tsx` now uses `@base-ui/react/menu` via `MenuPrimitive.*` (Root, Trigger, Portal, Backdrop, Positioner, Popup, Item, Group, GroupLabel, CheckboxItem, RadioItem, RadioGroup, Submenu, SubmenuTrigger, Separator).

## Changed

| File | What |
|---|---|
| `dropdown-menu.tsx` | full rewrite to base-ui menu primitives; public wrapper names preserved (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuGroup`, `DropdownMenuPortal`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`). |
| `dropdown-menu.tsx` | cva variants on the item wrapper (`variant: default/destructive`). |
| `dropdown-menu.tsx` | removed all internal `asChild` on `MenuPrimitive.*`; the base-ui wrapper uses `render` at the close button composition (no asChild needed at wrapper boundary). |

Per-file leftover scan: `grep -n "radix-ui\|@radix-ui"` on dropdown-menu.tsx → zero matches.

## Left alone

- `select.tsx`, `tabs.tsx`, `dialog.tsx`, `sheet.tsx` — separate reports.
- `assistant-ui/elements/*.tsx` — `ActionBarPrimitive.* asChild` is on radix-imported primitives (assistant-ui internals), untouched per the migration plan ("partial: keep assistant-ui's internal Radix as-is").

## Behavior changes

- **`<MenuPrimitive.Item>` closeOnClick defaults to TRUE** — `DropdownMenuItem` (regular items) still close on click; Topbar's theme picker works as before.
- **`<MenuPrimitive.CheckboxItem>` / `<RadioItem>` closeOnClick defaults to FALSE** — skill rule; no current consumers of `DropdownMenuCheckboxItem`/`DropdownMenuRadioItem` in app code (grep zero matches).
- **`<MenuPrimitive.Item>` `onSelect` event details** — skill "Callback signature rule"; single-arg handlers stay type-safe.
- **DropdownMenuTrigger asChild → render** — per skill universal rule. One consumer updated (Topbar).

## Consumer sweep

| File | Site | Fix |
|---|---|---|
| `Topbar.tsx:169` | `<DropdownMenuTrigger asChild><Button .../></DropdownMenuTrigger>` | `<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Toggle theme" />}>{icon}</DropdownMenuTrigger>` |

## Verify by hand

- Topbar theme menu: open, click any item (Light/Dark/System), confirm:
  - Menu closes after the theme change
  - The selected theme's icon now shows in the trigger
- Confirm keyboard nav (arrow keys, Enter, Esc) and focus return on close.