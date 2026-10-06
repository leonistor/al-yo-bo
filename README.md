# al-yo-bo

**al-yo-bo** is a single-user bookmark manager: capture links, organize them, search them, and chat
about them.

- Organize bookmarks into categories, each containing many tags.
- Search by tag, description, title, URL, category, and scraped page content.
- Browse as a list or a grid.
- Chat with an AI assistant to search and get suggestions, without losing your place in the UI.
- Import bookmarks from markdown collection files.

> **Status:** MVP complete. Capture, markdown import, scrape + embed enrichment (background job
> loop), keyword/semantic/hybrid search, Qdrant-backed semantic serving, Ollaya classification with
> a first-run setup wizard that seeds vocabulary from a developer profile, and Ollama-backed chat are
> implemented. OpenRouter chat for production is the remaining next step (see
> `docs/ARCHITECTURE.md` §2).

## Documentation

| Doc                                          | What it covers                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The reference: stack, system design, search, classifier workflow, deployment |
| [docs/MODEL.md](docs/MODEL.md)               | SQLite data model, invariants, deletion semantics                            |
| [docs/DESIGN.md](docs/DESIGN.md)             | UI design system                                                             |
| [AGENTS.md](AGENTS.md)                       | Instructions for coding agents                                               |

## Development

Requires [Bun](https://bun.com). For page scraping, also install the
[html-to-markdown CLI](https://github.com/xberg-io/html-to-markdown) (e.g. `brew install html-to-markdown`)
— without it bookmarks still save, but page content is never fetched.

Imported bookmarks also get a screenshot. macOS captures it with `Bun.WebView` (nothing to
install); on Linux, install the pinned headless Chrome once with `bun run chrome:install`.

Bun auto-loads a root `.env` file — copy `.env.example` and uncomment what you need (see
`.env.example` for the full list of optional variables).

Enrichment and semantic search are optional and degrade gracefully. OpenRouter is a
production-only provider: its defaults engage under `NODE_ENV=production` (`bun run start`);
development (`bun run dev`) runs on the local Ollama path with keyword-only search:

```sh
export OPENROUTER_API_KEY=...   # production embeddings; dev search stays keyword-only
# EMBEDDING_MODEL defaults to openai/text-embedding-3-small (1536 dims)
```

Chat runs on a local [Ollama](https://ollama.com) daemon and is off until a model is chosen:

```sh
export OLLAMA_CHAT_MODEL=llama3.2   # must support tool calling
# OLLAMA_URL defaults to http://127.0.0.1:11434
```

Import extraction uses an LLM by default. In production the default is the OpenRouter model
`deepseek/deepseek-v4.1-flash` (needs `OPENROUTER_API_KEY`); development prefers the configured
Ollama chat model, and with neither the deterministic markdown parser is the fallback. An explicit
`EXTRACT_MODEL` wins in either environment (a `/`-containing id selects OpenRouter):

```sh
export EXTRACT_MODEL=deepseek/deepseek-v4.1-flash   # any environment (needs OPENROUTER_API_KEY)
```

```sh
bun install       # install dependencies
bun run dev       # server (:3000) + web dev server (Vite)
bun run db:seed   # load the octocat demo fixture (synthetic, vendorable) into DATA_DIR
bun run build     # build the web app into apps/web/dist
bun run start     # production: one Bun process serves API + web
bun run lint      # lint
bun run format    # format
bun run typecheck # typecheck every workspace
bun test          # tests
```

Development isolation is a scratch data root: `DATA_DIR=/tmp/ayo-scratch bun run dev` gives a clean
tree (DB, seeds, vectors); there is no profile-switching mechanism — the app is single-user with one
workspace.

On startup the server reconciles enrichment: bookmarks without scraped content are scraped and
embedded in a background job loop (`docs/ARCHITECTURE.md` §8), so seeded or imported bookmarks get
their page content and vectors automatically when scraping and embeddings are available.

## Usage

Quick orientation:

- **Search** — one box, three modes: **keyword** (FTS5), **semantic**, and **hybrid** (rank fusion).
  Press `/` to focus the search.
- **Capture** — add a URL from the top bar, or import a whole markdown collection file; bookmarks
  are upserted by URL (globally unique), so re-importing merges instead of duplicating.
- **Organize** — categories form an orderable tree (drag to reorder or nest in the sidebar) and
  tags classify bookmarks. On first run, a setup wizard suggests tags and categories from a
  developer-profile questionnaire; confirming creates them outright.
- **Live updates** — the server pushes coarse events over SSE; lists, tags, and job progress update
  without a refresh (ARCHITECTURE §9).
- **Profile** — the single user's name, GitHub username, and avatar (initials until a file is
  uploaded) show in the top bar and sidebar.
- **MCP** — a read-only bookmarks MCP server is mounted at `/mcp` (search, get, categories, tags;
  `MCP_TOKEN` adds a bearer check) for agents and Claude Desktop (ARCHITECTURE §8).
- **Chat** — ask the assistant to search and suggest without losing your place in the list.

### Importing bookmarks from markdown

The main way to get bookmarks in is a markdown collection file. In the UI, use the **Import** button
(top bar) and either paste the markdown or upload a file, then **Extract** to preview the parsed
bookmarks.

Collection files use headings and bullets:

```md
## AI dev

- The debugger for AI agents: https://github.com/HoneycombHairDevelopers/Meterbility

### scraping

- Fast scraper: https://example.com/scraper
```

- `## Heading` (H2) becomes a **category** (unless an `###` follows).
- `### Heading` (H3) becomes a **category** inside the current heading.
- A bullet with a URL becomes a bookmark; the note text stands in for the title until the page is
  scraped.
- A leading `*`/`**`/`***` on a bullet is a personal priority (1–3).
- YAML frontmatter `tags: [a, b]` attaches tags (missing ones are created automatically).

**Import is direct-commit.** Clicking **Extract** runs LLM extraction (or the deterministic parser
when no LLM is configured) and shows editable rows. Clicking **Import** commits them immediately:
missing categories and tags are created as **active**, bookmarks are upserted by URL (so re-importing
the same file merges instead of duplicating), and enrichment is queued. There is no staging step.

### First-run setup wizard

When `profile.setup_completed_at` is `null`, the app shows a setup wizard instead of the library:

1. **Identity** — name and GitHub username.
2. **Developer profile** — questionnaire about source, focus, languages, frameworks, tools,
   experience, and optional notes.
3. **Suggestions** — an LLM proposes tags and categories from the profile. You check the ones you
   want; if no LLM is configured, this step is skipped.
4. **Confirm** — checked suggestions are created, setup completes, and the app loads.

Vocabulary is also created automatically by markdown import. Below-threshold classifier output is
simply not assigned; manual tagging is the recovery.

### Seed fixture

The canonical seed is the synthetic **octocat** demo (`packages/db/seeds/` — curated, vendorable
real well-known URLs under the octocat profile, with a tree-native markdown source that exercises
the real import path). `bun run db:seed` loads it into `DATA_DIR`, wiping prior content first
(dev data is disposable; use a scratch `DATA_DIR` for isolation). It is also the fixture every
integration test and the visual QA run against. Real personal collections are not fixtures;
`docs/examples-mds/*` are import-format examples only.

Seeding is idempotent (bookmarks are upserted by URL). To start from a clean slate, point `DATA_DIR`
at an empty directory — the database is born at migration `0001` in the final shape.

The app is built milestone by milestone; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
target layout (`apps/server`, `apps/web`, `packages/core` + the subsystem packages `db`, `search`,
`vectordb`, `ai`, `importer`, `shared`).
