# al-yo-bo

**al-yo-bo** lets one developer capture, organize, search, and chat about bookmarks:

- Organize bookmarks into categories, each containing many tags.
- Search by tag, description, title, URL, category, and scraped page content.
- View bookmarks as a list or a grid.
- Chat with an AI assistant to search and get suggestions.
- Switch easily between chat and the traditional UI.
- Import bookmarks from various markdown files, examples in [docs/examples-mds](docs/examples-mds).

## Architecture

As much as possible, the implementation should rely on bun's native APIs and ecosystem and [package manager features](https://bun.com/guides/install/from-npm-install-to-bun-install). A [bun monorepo](https://bun.com/guides/install/workspaces) will be used to manage dependencies and build processes.

Some **examples** of what can be done with bun's native APIs:

- [Hono RPC and React Monorepo Template](https://vladimir.vovk.in/blog/hono-rpc-and-react-monorepo-template)
- [Bun SQL Backend for Frontend Devs](https://samuellawrentz.com/blog/bun-sql-backend-for-frontend-devs/)

The design favors well-documented, self-hostable, open-source components over bespoke infrastructure.

## Data model

See [docs/MODEL.md](docs/MODEL.md)

## Technology stack

| Layer           | Choice                           | Notes                                    | URL                                                                                                  |
| --------------- | -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Runtime         | **Bun**                          | Node only if a dependency forces it      | [bun.com](https://bun.com)                                                                           |
| Web framework   | **Hono**                         | server routes                            | [hono.dev](https://hono.dev)                                                                         |
| Reactive client | **React 19 + Hono RPC**          | UI                                       | [react.dev](https://react.dev), [https://hono.dev/docs/guides/rpc](https://hono.dev/docs/guides/rpc) |
| UI components   | **shadcn/ui**                    |                                          | [ui.shadcn.com](https://ui.shadcn.com)                                                               |
| Chat UI         | **assistant-ui**                 | AI SDK runtime                           | [assistant-ui.com](https://assistant-ui.com)                                                         |
| Classifier      | **Ollaya**                       | open decision models, single binary      | [ollaya.dev](https://ollaya.dev)                                                                     |
| LLM access      | **AI SDK**                       | Ollama locally, OpenRouter in production | [ai-sdk.com](https://ai-sdk.com)                                                                     |
| Embeddings      | **OpenRouter** + **sqlite-vec**  |                                          | [openrouter.com](https://openrouter.com)                                                             |
| Search          | **SQLite FTS5** + **sqlite-vec** | keyword + semantic, same DB              | [sqlite.org](https://sqlite.org)                                                                     |
| Background jobs | **OpenWorkflow**                 | durable workflows, SQLite, Bun-native    | [openworkflow.dev](https://openworkflow.dev)                                                         |
| Configuration   | **env**                          |                                          | [env](https://bun.com/docs/runtime/environment-variables)                                            |
| Deployment      | **shell scripts**                |                                          |                                                                                                      |

## Tooling

- [oxfmt + oxlint](https://oxc.rs/)
- [opencode](https://opencode.ai/) and [oh-my-agent](https://omo.dev/)
- [Zed editor](https://zed.dev/)
