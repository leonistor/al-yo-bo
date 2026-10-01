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

```sh
bun install       # install dependencies
bun run dev       # server (:3000) + web dev server (Vite)
bun run db:seed   # load the seed dataset chosen by SEED_DATASET (default: grimoire)
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

### Seed datasets

Seed fixtures live in `packages/db/seeds/datasets/` and `bun run db:seed` loads the dataset named
by `SEED_DATASET` (default `grimoire`, the synthetic demo fixture; unset or empty falls back to
the default). Datasets are registered explicitly in `packages/db/src/seed.ts` — dropping a file
in the directory doesn't make it selectable:

```sh
SEED_DATASET=grimoire   # which dataset db:seed loads (set in .env or via export)
# SEED_RESET=1          # uncomment to wipe existing bookmarks/tags/categories first
```

Seeding is otherwise idempotent (bookmarks are upserted by URL). The `leo` dataset (real
collections imported from `docs/examples-mds/`) is reserved but not implemented yet.

The app is built milestone by milestone; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
target layout (`apps/server`, `apps/web`, `packages/*`).
