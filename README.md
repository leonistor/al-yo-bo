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
> a human review queue, and Ollama-backed chat are implemented. OpenRouter chat for production is
> the remaining next step (see `docs/ARCHITECTURE.md` §2).

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

Enrichment and semantic search are optional and degrade gracefully:

```sh
export OPENROUTER_API_KEY=...   # embeddings; without it search stays keyword-only
# EMBEDDING_MODEL defaults to openai/text-embedding-3-small (1536 dims)
```

Chat runs on a local [Ollama](https://ollama.com) daemon and is off until a model is chosen:

```sh
export OLLAMA_CHAT_MODEL=llama3.2   # must support tool calling
# OLLAMA_URL defaults to http://127.0.0.1:11434
```

Import extraction uses an LLM by default. Set an OpenRouter model id to run it there (a `/`-containing
id needs `OPENROUTER_API_KEY`); without `EXTRACT_MODEL`, a configured Ollama chat model is used, and
with neither the deterministic markdown parser is the fallback:

```sh
export EXTRACT_MODEL=deepseek/deepseek-v4.1-flash   # OpenRouter extraction (needs OPENROUTER_API_KEY)
```

```sh
bun install       # install dependencies
bun run dev       # server (:3000) + web dev server (Vite)
bun run dev -- --profile=leo  # same, isolated under data/profiles/leo (DB, seeds, vectors)
bun run dev -- --profile=octocat --seed  # fresh profile, seed it (dataset via --seed=<name>), then boot
bun run dev -- --list-profiles  # list profiles created by previous --profile runs
bun run db:seed   # load the seed dataset chosen by SEED_DATASET (default: leo)
bun run db:clear  # wipe one dataset's content (asks first; --yes to skip)
bun run build     # build the web app into apps/web/dist
bun run start     # production: one Bun process serves API + web
bun run lint      # lint
bun run format    # format
bun run typecheck # typecheck every workspace
bun test          # tests
```

On startup the server reconciles enrichment: bookmarks without scraped content are scraped and
embedded in a background job loop (`docs/ARCHITECTURE.md` §8), so seeded or imported bookmarks get
their page content and vectors automatically when scraping and embeddings are available.

## Usage

Quick orientation:

- **Search** — one box, three modes: **keyword** (FTS5), **semantic**, and **hybrid** (rank fusion);
  everything is scoped to the active dataset. Press `/` to focus the search.
- **Capture** — add a URL from the top bar, or import a whole markdown collection file; bookmarks
  are upserted by URL within a dataset, so re-importing merges instead of duplicating.
- **Organize** — categories group bookmarks, tags classify them, and the classifier's
  below-threshold suggestions wait in the **review queue** for a manual accept.
- **Switch datasets** — datasets are separate workspaces (own bookmarks + vocabulary); seeding one
  activates it (`bun run db:seed` is the switch mechanism), and the profile's active dataset is what
  the app serves.
- **Profile** — the single user's name, GitHub username, and avatar (initials until a file is
  uploaded) show in the top bar and sidebar.
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

### Review queue

The Review queue (left sidebar) lists **classifier suggestions**: tags whose classification
probability fell below the auto-assign threshold. Accept one to assign it manually
(`source='user'`). Vocabulary itself is curated directly (rename, delete, deprecate) — there is no
proposal queue.

### Seed datasets

Seed fixtures live in `packages/db/seeds/datasets/` and `bun run db:seed` loads the dataset named
by `SEED_DATASET` (default `leo`, Leo's real collections). Datasets are registered explicitly in
`packages/db/src/seed.ts` — dropping a file in the directory doesn't make it selectable:

```sh
SEED_DATASET=leo        # which seed fixture db:seed loads (set in .env or via export)
# SEED_DATASET=grimoire # the synthetic Grimoire demo fixture the tests use
# SEED_RESET=1          # uncomment to wipe the target dataset's content first
# SEED_ACTIVATE=0       # uncomment to load WITHOUT making it the active dataset
```

Seeding **activates** the dataset it loads: the profile's active-dataset pointer is set to it, so
the server scopes to whatever was loaded on its next boot — seeding is the dataset-switch
mechanism. `SEED_ACTIVATE=0` loads without switching.

`leo` is generated from the five-file representative sample in `docs/examples-mds/`; regenerate it
after editing those collections with:

```sh
bun run scripts/extract-leo-seed.ts
```

Seeding is otherwise idempotent (bookmarks are upserted by URL).

### Clearing a dataset

To test imports from a clean slate, `bun run db:clear` wipes one dataset's bookmarks and vocabulary
(sections, categories, tags), keeping the dataset row itself so the name can be reused. It prompts
for confirmation; pass `--yes` to skip it. Without an argument it clears the **active dataset**
(the profile's pointer, then `DEFAULT_DATASET`, then `default` — the same precedence the server
boot uses):

```sh
bun run db:clear            # clear the active dataset
bun run db:clear leo --yes  # clear the "leo" dataset without prompting
```

`SEED_RESET=1` runs the same dataset-scoped wipe before seeding (other datasets are never
touched); `db:clear` is the standalone form. Qdrant points for removed bookmarks are repaired from
SQLite at the next server startup.

The app is built milestone by milestone; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
target layout (`apps/server`, `apps/web`, `packages/core` + the subsystem packages `db`, `search`,
`vectordb`, `embeddings`, `classifier`, `importer`, `shared`).
