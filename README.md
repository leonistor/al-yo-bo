# al-yo-bo

**al-yo-bo** is a single-user bookmark manager: capture links, organize them, search them, and chat
about them.

- Organize bookmarks into categories, each containing many tags.
- Search by tag, description, title, URL, category, and scraped page content.
- Browse as a list or a grid.
- Chat with an AI assistant to search and get suggestions, without losing your place in the UI.
- Import bookmarks from markdown collection files.

> **Status:** early implementation. The architecture, data model, and design are decided; the Bun
> workspace, database, search, importer, server API, and web UI are in place.

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

Enrichment and semantic search are optional and degrade gracefully:

```sh
export OPENROUTER_API_KEY=...   # embeddings; without it search stays keyword-only
# EMBEDDING_MODEL defaults to openai/text-embedding-3-small (1536 dims)
```


```sh
bun install       # install dependencies
bun run dev       # server (:3000) + web dev server (Vite)
bun run db:seed   # load the synthetic demo seed data
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

The app is built milestone by milestone; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
target layout (`apps/server`, `apps/web`, `packages/*`).
