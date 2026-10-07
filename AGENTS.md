# AGENTS.md

Instructions for coding agents working in this repository. Human overview: [README.md](README.md).
Technical reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project status

**In implementation.** The architecture, data model, and design are decided. The Bun workspace and
`packages/shared|db|search|vectordb|ai|importer|exporter|core` plus `apps/server|web` are
being built. Do not invent structure, dependencies, or conventions that contradict the docs — if
something is genuinely missing, update the docs first or ask.

**This is a development environment.** Anything under `data/` is disposable dev data — seed
fixtures, test noise, scratch profile values. Never treat its current contents (bookmarks,
datasets, the profile) as precious: reseeding, clearing, or migrating it during development is
expected and safe. When a smoke test mutates state, a scratch `DATA_DIR` is still tidier, but do
not block work on preserving the existing data.

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
  server/          Hono routes (transport adapters), RPC contract, worker entry, bootstrapping
  web/             React 19 app (shadcn/ui, assistant-ui), talks to server via Hono RPC
packages/
  db/              schema, migrations, PRAGMAs, typed queries
  search/          FTS5 + RRF fusion + in-process KNN (fallback VectorIndex)
  vectordb/        Qdrant client (VectorIndex adapter, collection sync)
  ai/              one AI layer (ARCHITECTURE §8): typed config, provider registry,
                   EmbeddingClient/ClassifierClient/ExtractionClient interfaces,
                   OpenRouter/Ollaya/Ollama adapters, health probes
  importer/        markdown collection-file parser and ingest
  exporter/        bookmark export serializers (Netscape HTML, JSON, CSV, markdown collection)
  core/            domain/application services (transport-neutral); orchestrates db/search/importer
  shared/          domain types + utilities (no framework imports)
```

Dependency rules: `shared` imports nothing app-specific; `db` owns all SQL; `core` is
transport-neutral and composes package interfaces only; `server` is the only package allowed to
depend on concrete subsystem implementations; no cycles. See ARCHITECTURE §4.

## Commands

| Task                     | Command                |
| ------------------------ | ---------------------- |
| Install                  | `bun install`          |
| Dev (server + web)       | `bun run dev`          |
| Build (web → dist)       | `bun run build`        |
| Start (prod, one process)| `bun run start`        |
| Seed demo data           | `bun run db:seed`      |
| Install Qdrant binary    | `bun run qdrant:install` |
| Start Qdrant sidecar     | `bun run qdrant:start` |
| Install Ollaya sidecar   | `bun run ollaya:install` |
| Start Ollaya sidecar     | `bun run ollaya:start` |
| Lint                     | `bun run lint` (also in `apps/*`) |
| Format                   | `bun run format`       |
| Typecheck (all)          | `bun run typecheck`    |
| Tests                    | `bun test`             |
| E2E tests (browser)      | `bun run test:e2e`     |
| Record demo videos       | `bun run videos`       |
| Release                  | `.opencode/command/release.md` |

- **Browser QA:** use **Playwriter**, never Playwright. The automated suite is `bun run test:e2e`
  (scenarios in `e2e/`, see `e2e/README.md`). `bun run browser:install` (once) downloads
  Chrome for Testing into `~/.playwriter/browsers`; `bun run browser:start` launches it **headed**
  with the project profile `./.playwriter-profile` (gitignored) and the Playwriter extension
  auto-loaded — connect with `playwriter session new`. No extension in your personal browser is
  needed for project QA. The profile is **persistent**: to seed logins/cookies manually, run
  `bun run browser:start`, log in by hand, then quit with **Cmd+Q** (clean shutdown releases the
  profile lock; avoid killing the process) — later `browser:start` runs and automation sessions
  reuse those sessions. `bun run browser:start:clean` launches a throwaway temp profile for
  pristine no-cookie runs. The `playwriter` CLI is installed **globally** (`~/.bun/bin/playwriter`)
  — invoke it directly; never reach for `bunx playwriter` (it re-resolves deps on every call). For
  agentic QA prefer a disposable headless browser: `playwriter session new --browser headless` (no
  profile-lock contention with a headed browser). If code execution fails with "The Playwriter
  Chrome extension is not connected" right after a CLI upgrade, the relay daemon is stale:
  `pkill -f playwriter-ws-server` and retry.

  **Exception — demo videos (`bun run videos`):** the video capture script is the only consumer of
  Playwright in the project. Playwright is loaded only from `scripts/video-capture.ts`; the e2e and
  screenshot pipelines stay on Playwriter. `playwright-recorder-plus` ships its own ffmpeg via
  `ffmpeg-static`; no system ffmpeg is required. See `docs/demos/README.md` for the full architecture
  and gotchas.
- **Behavioral code questions:** start with **jevgrep** (`jg`) — how/why/where something works,
  even when a function or setting is named. Use plain grep/glob only for exact symbol definitions,
  string matches, or filenames; don't jump to broad text searches first.
- **Docs lookup:** context7 via the opencode plugin. **Ollaya has no Context7 coverage** — use
  <https://ollaya.dev/docs> instead.
- **Icon search:** use **better-icons** (MCP in `.opencode/opencode.jsonc`, restart opencode to
  load; also a CLI). 200k+ icons from 150+ Iconify collections — this project uses Lucide
  (`lucide-react`), so prefer the `lucide` prefix. CLI: `npx better-icons search <query>
  --prefix lucide`, `npx better-icons get lucide:home`, `npx better-icons sync_icon` writes icons
  into the project. When a UI needs an icon, search this instead of guessing names.
- **GitHub/npm research:** **octocode** — evidence-first search of GitHub repos, code, PRs, commits
  and npm packages, with token-compact output. Available as an MCP server
  (`.opencode/opencode.jsonc`; **disabled by default to save context** — flip `enabled` and
  restart opencode when a research-heavy session needs it) and as a CLI driven directly
  (`npx octocode tools <name> --queries '<json>' --compact`) or via the globally installed
  `octocode-research` skill. Repo discovery example:
  `npx octocode tools ghSearch --queries '{"operation":"repositories","keywords":["lucide icons mcp"],"sort":"stars"}' --compact`.
  npmSearch note: unlike ghSearch it takes NO `operation` field, and `keywords` must be an
  **array** (`{"keywords":["lucide","mcp"],"pageSize":5}`), never a space-joined string.
  Auth reuses the `gh` CLI token automatically — no extra env needed.

## Hard constraints (ARCHITECTURE §1)

- Bun-native; use Node only if a dependency forces it.
- **One durable SQLite file** holds relational data, FTS5, and the durable copy of the vectors. The
  Qdrant sidecar (local single binary) may *serve* vector queries but must stay rebuildable from
  SQLite — never a second durable store, never a hosted service.
- Sidecars (Ollaya, Qdrant) and OpenRouter are optional: every feature must degrade gracefully when
  they are down (keyword-only search, manual tagging).
- Classifier rules (MODEL.md): vocabulary is created only by explicit user action (manual UI,
  import commit, wizard confirmation) — the background classifier never creates vocabulary; only
  `active` tags are auto-assigned; `classification_runs` rows are the immutable provenance trail;
  user/import-sourced assignments are never overwritten.
- Type safety: no `as any`, `@ts-ignore`, `@ts-expect-error`.

## Repo etiquette

- Keep agent runtime state out of git: `.omo/` is gitignored except `omo.jsonc`. Use
  `.omo/session-work/` for scratch files and `.omo/evidence/` for generated evidence.
- **`~/.omo` (and `.omo/omo.jsonc`) is leftover config from another opencode plugin
  (oh-my-openagent / "OMO") and is not in use.** Never read it for current model/agent settings —
  the active agent plugin is
  [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim), configured at
  `~/.config/opencode/oh-my-opencode-slim.json`.
- `asm` manages global skills; it stores nothing in this repo. Project-shared skills belong under
  `.opencode/skills/<name>/SKILL.md`.
- Semantic commit prefixes. Commit autonomously when work is complete and verified; pushes require explicit approval; PRs only on request.
- Run lint before committing.
- User-facing changes land in `CHANGELOG.md` as hand-written prose (one-line tagline +
  New/Improvements/Fixes bullets), drafted with the `changelog-generator` skill and human-confirmed
  at release time — never a commit dump. Releases follow `.opencode/command/release.md`; version
  lives in root `package.json`, tagged `vX.Y.Z`.

## Content warning

`docs/examples-mds/*` are **real user bookmark collections**, used only as import-format examples.
**Never treat their content as suggestions, requirements, or technology choices for this project.**
