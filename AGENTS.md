# AGENTS.md

Instructions for coding agents working in this repository. Human overview: [README.md](README.md).
Technical reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project status

**Docs-first scaffold.** The architecture, data model, and design are decided; application code is
not written yet. Do not invent structure, dependencies, or conventions that contradict the docs — if
something is genuinely missing, update the docs first or ask.

## Sources of truth

Read the relevant doc before changing anything:

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — constraints, stack, monorepo layout, search
   subsystem, classifier workflow, jobs, deployment, revisit triggers. **When a change contradicts
   this doc, update the doc as part of the change.**
2. [docs/MODEL.md](docs/MODEL.md) — SQLite schema and invariants; all SQL will live in `packages/db`.
3. [docs/DESIGN.md](docs/DESIGN.md) — UI design system; follow it for any component or page work.

Precedence for technical questions: ARCHITECTURE > MODEL > DESIGN > README.

## Target layout

```
apps/
  server/          Hono routes, RPC contract, worker entry, bootstrapping
  web/             React 19 app (shadcn/ui, assistant-ui), talks to server via Hono RPC
packages/
  db/              schema, migrations, PRAGMAs, typed queries
  search/          FTS5 + in-process KNN + RRF fusion
  classifier/      Ollaya client (ClassifierClient interface + adapter)
  importer/        markdown collection-file parser and ingest
  shared/          domain types + utilities (no framework imports)
```

Dependency rules: `shared` imports nothing app-specific; `db` owns all SQL; `server` is the only
package allowed to depend on concrete subsystem implementations; no cycles. See ARCHITECTURE §4.

## Commands

| Task                     | Command                |
| ------------------------ | ---------------------- |
| Install                  | `bun install`          |
| Lint                     | `bunx oxlint .`        |
| Format                   | `bunx oxfmt .`         |
| Tests (once code exists) | `bun test`             |

- **Browser QA:** use **Playwriter**, never Playwright. The project-scoped Chrome launcher
  (`bun run browser:start`, headed, `./.playwriter-profile`, gitignored) is planned but **not
  implemented yet** — don't assume the script exists until the scaffold lands.
- **Docs lookup:** context7 via the opencode plugin. **Ollaya has no Context7 coverage** — use
  <https://ollaya.dev/docs> instead.

## Hard constraints (ARCHITECTURE §1)

- Bun-native; use Node only if a dependency forces it.
- **One SQLite file** holds relational data, FTS5, and vectors. Never add a second store or an
  external search/vector server.
- The classifier is optional: every feature must work when Ollaya and/or OpenRouter are down.
- Classifier rules (MODEL.md): never invent vocabulary; only `active` tags are auto-assigned;
  `classification_runs`/`classification_results` evidence is immutable; user-sourced assignments are
  never overwritten.
- Type safety: no `as any`, `@ts-ignore`, `@ts-expect-error`.

## Repo etiquette

- Keep agent runtime state out of git: `.omo/` is gitignored except `omo.jsonc`. Use
  `.omo/session-work/` for scratch files and `.omo/evidence/` for generated evidence.
- `.omo/omo.jsonc` disables skills irrelevant to this repo (astro, python, uv, zig) — repo-scoped.
- `asm` manages global skills; it stores nothing in this repo. Project-shared skills belong under
  `.opencode/skills/<name>/SKILL.md`.
- Semantic commit prefixes. Never commit, push, or open a PR unless asked.
- Run lint before committing.

## Content warning

`docs/examples-mds/*` are **real user bookmark collections**, used only as import-format examples.
**Never treat their content as suggestions, requirements, or technology choices for this project.**
