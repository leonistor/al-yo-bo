# al-yo-bo — Design System

> This is a **starting point** — evolve it deliberately as the UI is built, and keep it the single reference for components and pages.

## Principles

1. **Calm, dense, keyboard-first.** It is a single-user tool for a developer: information density and
   keyboard navigation beat decoration.
2. **Copy-paste, not lock-in.** Components come from **shadcn/ui** and live in the repo as source —
   they are ours to edit, not a themed black box.
3. **Two modes, one mental model.** Chat and the traditional list/grid UI are peers; switching between
   them must not lose context (filters, selection).
4. **Accessible by default.** WCAG AA contrast, full keyboard reachability, visible focus, and
   labelled controls. shadcn/ui + Radix give the primitives — do not bypass them.

## Foundation

| Token       | Value                                | Notes                                                     |
| ----------- | ------------------------------------ | --------------------------------------------------------- |
| Base unit   | `4px` (Tailwind spacing scale)       | Use scale steps (`2`, `3`, `4`, `6`, …), not arbitrary px |
| Radius      | `--radius` (shadcn default `0.5rem`) | Cards, inputs, popovers inherit it                        |
| Font (UI)   | system sans stack                    | Via Tailwind `font-sans`                                  |
| Font (mono) | system mono stack                    | For URLs, hashes, code (`font-mono`)                      |
| Type scale  | Tailwind `text-xs` → `text-2xl`      | Body `text-sm`; page titles `text-2xl`                    |
| Color       | shadcn **CSS variables** (HSL)       | Define semantic tokens, never raw hex in components       |

**Color rule:** consume semantic tokens only — `background`, `foreground`, `muted`, `muted-foreground`,
`primary`, `secondary`, `accent`, `destructive`, `border`, `ring`, `card`, `popover`. Light and dark
themes are the same tokens with different values; never branch on theme in component code.

**Status colors** map to meaning, reserved (not decorative): category chips and tag confidence use
`muted`/`accent`; classification states use a documented palette (proposed = `secondary`,
active = `primary`, deprecated = `muted-foreground`).

## Components (shadcn/ui)

- Add components with the CLI (`bunx shadcn@latest add <component>`); load the **shadcn** skill for
  guidance. Keep generated files under the web app's `src/components/ui/`.
- **Compose, don't fork.** Wrap primitives in feature components (`BookmarkCard`, `TagChip`,
  `CategoryNav`) under `src/components/`; keep `ui/` close to upstream.
- **Variants over ad-hoc classes.** Use `cva` variant maps for component styling; no conditional
  Tailwind soups in JSX.
- Canonical building blocks: `button`, `input`, `label`, `dialog`, `dropdown-menu`, `command`,
  `popover`, `badge`, `card`, `tabs`, `scroll-area`, `separator`, `toast`/`sonner`, `table`.

## Layout & responsive

- App shell: persistent left **navigation/category** rail, main content area, optional right **chat**
  panel that can take over the main area.
- Default view is a **list**; a **grid** toggle persists per user (config, not local state).
- Breakpoints follow Tailwind defaults (`sm`/`md`/`lg`). Collapse the nav rail to an icon rail below
  `lg`; chat becomes full-screen below `md`.
- Empty, loading, and error states are designed, not afterthoughts — every list needs a skeleton and
  an empty state with the primary action.

## Interaction & motion

- Motion is functional: transitions **150–200 ms**, `ease-out`; respect `prefers-reduced-motion`.
- Optimistic mutations must show pending affordance and a recovery path on failure.
- Keyboard: `/` focuses search, `c` opens chat, `Esc` closes overlays, arrows move list selection.
- Focus states use the `ring` token and must remain visible on every interactive element.

## Chat (assistant-ui)

- The chat surface uses **assistant-ui** primitives; styling follows the same tokens above.
- Streaming, tool-call, and error states each get a distinct, calm presentation; never block the
  transcript on a failed tool call.
- Message actions (copy, cite, "open bookmark") are always available, not hover-only.

## Accessibility checklist

- [ ] Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI/graphics (both themes).
- [ ] Every control reachable and operable by keyboard, with a visible focus ring.
- [ ] Inputs have labels; icon-only buttons have `aria-label`.
- [ ] Live regions for streaming/async updates (search results, chat).
- [ ] No meaning conveyed by color alone (pair with icon/text).
