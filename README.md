# al-yo-bo

**al-yo-bo** lets one developer capture, organize, search, and chat about bookmarks:

- Organize bookmarks into categories, each containing many tags.
- Search by tag, description, title, URL, category, and scraped page content.
- View bookmarks as a list or a grid.
- Chat with an AI assistant to search and get suggestions.
- Switch easily between chat and the traditional UI.
- Import bookmarks from various markdown files, examples in [docs/examples-mds](docs/examples-mds). The content of this files should **not** be used as agents suggestions.

## Architecture

As much as possible, the implementation should rely on bun's native APIs and ecosystem and [package manager features](https://bun.com/guides/install/from-npm-install-to-bun-install). A [bun monorepo](https://bun.com/guides/install/workspaces) will be used to manage dependencies and build processes.

Some **examples** of what can be done with bun's native APIs:

- [Hono RPC and React Monorepo Template](https://vladimir.vovk.in/blog/hono-rpc-and-react-monorepo-template)
- [Bun SQL Backend for Frontend Devs](https://samuellawrentz.com/blog/bun-sql-backend-for-frontend-devs/)

The design favors well-documented, self-hostable, open-source components over bespoke infrastructure.

## Data model

See a previous attempt at [docs/MODEL.md](docs/MODEL.md), to be treated as a suggestion.

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

- **Package manager / workspaces:** Bun.
- **Lint:** `oxlint` and **Format:** [oxfmt + oxlint](https://oxc.rs/)
- **Browser QA:** use **Playwriter**, not Playwright. Start the project-scoped Chrome with `bun run browser:start` (headed, `./.playwriter-profile`, gitignored). Install the skill once with `npx -y skills add https://playwriter.dev`.
- **Docs lookup:** **context7** (via the opencode plugin). Note **Ollaya has no Context7 coverage** — use offline/manual docs for it.

## Agent tooling

- **opencode + oh-my-openagent (omo)** provide the agent harness. Keep runtime state out of git
  (`.omo/`, `.codegraph` are gitignored). [opencode](https://opencode.ai/) and [oh-my-agent](https://omo.dev/)
- **agent-skill-manager (`asm`)** is a global tool for managing installed skills; it stores nothing in this repo. Useful: `asm list --json`, `asm install <skill> -p opencode`, `asm audit security`. Project-shared skills would be committed under `.opencode/skills/<name>/SKILL.md`.
- Use `./.omo/session-work/` for scratch files and `./.omo/evidence/` for generated evidence (gitignored).
