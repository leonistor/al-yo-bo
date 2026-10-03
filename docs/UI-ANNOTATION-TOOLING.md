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

Mounted in `apps/web/src/main.tsx` behind `import.meta.env.DEV` via a dynamic
import, so Vite tree-shakes it (and everything it pulls in) out of production
builds. Toolbar behavior is default; `appName="al-yo-bo"` is included in output.
Click an element, type a note, Copy — paste the markdown into the agent session.

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
