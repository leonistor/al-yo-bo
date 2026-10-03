# UI annotation tooling (dev-only)

Decision record for the in-app annotation toolbar used to send visual feedback to
coding agents during development. Not part of the product; never bundled to production.

## Decision

**[Agentation](https://github.com/benjitaylor/agentation)** (original, not the
[@panrafal fork](https://www.npmjs.com/package/@panrafal/agentation), which is a
stale single-version republish).

- npm: [`agentation`](https://www.npmjs.com/package/agentation) (v3.1.2, active Sep 2026)
- Docs: <https://agentation.com>
- License: PolyForm Shield 1.0.0 (source-available, not OSI — acceptable for an
  internal dev-only tool; do not ship in the production bundle)
- Why: most mature option (4.8k★, ~2M weekly downloads), React 18+ peer works with
  our React 19, no runtime deps, structured markdown output, plus optional MCP sync
  ([`agentation-mcp`](https://www.npmjs.com/package/agentation-mcp)) if we ever want
  a direct agent loop instead of copy/paste.

## Usage

Mounted in `apps/web/src/main.tsx` behind
`import.meta.env.DEV && import.meta.env.VITE_ANNOTATE === '1'` via a dynamic
import — the flag is exported by `scripts/dev.sh` only when the stack runs with
`--annotate`, so plain `bun run dev` shows no toolbar, and Vite tree-shakes the
component (and everything it pulls in) out of production builds.
Toolbar behavior is default; `appName="al-yo-bo"` is included in output.

Entry point: the floating toolbar (FAB) in the bottom-right corner. Click it to
activate feedback mode, then click any element, type a note, Add. The expanded
controls offer Copy feedback, Clear all, Settings, animation pause, and layout
mode; Esc exits. Paste the copied markdown into the agent session.

## MCP server (local)

Agentation's feedback loop runs through a local MCP server
([`agentation-mcp`](https://www.npmjs.com/package/agentation-mcp), root
devDependency; one process serves both HTTP for the toolbar and stdio MCP for
agents over a shared store):

- **Browser side:** `bun run dev -- --annotate` starts it via `dev:agentation`
  (`agentation-mcp server`, HTTP on <http://localhost:4747>; the annotation
  server is opt-in — plain `bun run dev` skips both the server and the
  toolbar); the component points at it with `endpoint="http://localhost:4747"`.
- **Agent side:** registered as the `agentation` MCP server in
  `.opencode/opencode.jsonc` with `--mcp-only --http-url http://localhost:4747`
  — stdio MCP joins the dev-run store instead of binding its own port (no
  4747 conflict). Restart opencode after config changes.
- **Workflow:** annotate in the browser, then ask the agent to list pending
  feedback (`agentation-mcp doctor` checks node/server/config health). The
  `/annotate` project command (`.opencode/command/annotate.md`) automates the
  full loop: start `bun run dev -- --annotate`, capture annotations to
  `.omo/evidence/`, fix and resolve them, and stop the stack when you say DONE.

## Alternatives considered

| Tool | Link | Notes |
| --- | --- | --- |
| agent-ui-annotation | <https://github.com/YeomansIII/agent-ui-annotation> · <https://www.npmjs.com/package/agent-ui-annotation> | MIT, framework-agnostic (Lit web component + React/Vue/Svelte adapters), forensic detail level; smaller adoption (67★), no MCP |
| earmark | <https://github.com/nahar-strativ/Agentic> | Framework-agnostic overlay + MCP server, Vite/webpack/Turbopack source-stamping plugins |
| agent-snap | <https://github.com/vampaz/agent-snap> | DOM snapshot + annotation, Shadow DOM support, screenshots, Vite plugin, Chrome extension |
| patch-mark | <https://lkrcharon.github.io/patch-mark/> | ~19 KB gzip ESM web component, optional MCP server |
| ui-referee | <https://github.com/ayreddy/ui-referee> | Single-file JS, zero deps, JSON + AI-prompt export |
| Markagent | <https://chromewebstore.google.com/detail/markagent-uiweb-feedback/hbmbjdgdofkpddalhjoapppnkoicpdjj> | Chrome extension, journey recording + screenshot-backed prompts |
| visual-annotator / Annota | <https://github.com/wernerstrauch/visual-annotator> · <https://github.com/K4nes/Annota> | Chrome-extension variants with screenshots + console-log capture |

Revisit if: the PolyForm license becomes a problem, Agentation goes unmaintained,
or we want MCP round-tripping (then earmark or `agentation-mcp` are first options).
