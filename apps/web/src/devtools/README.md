# al-yo-bo devtools (chrome-devtools-mcp third-party tools)

> **Status: experimental, DEV-only.** Not part of the user-facing product.
> Wired to chrome-devtools-mcp's `devtoolstooldiscovery` API
> ([docs](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/third-party-developer-tools.md))
> so an AI agent driving Chrome can query the app's internal state without
> scraping the DOM.

## Why

`App.tsx` holds search/filter/sort state in `useState` and the server data
lives in TanStack Query. The DOM is rich but not *semantic* — a DOM scrape
cannot reliably answer "what filter is active?" or "is this tag in the
active vocabulary?". These tools expose the state machine directly so an
agent can answer those questions in one call.

End users see nothing: the whole tree is dead-code-eliminated from
production builds because `main.tsx` only mounts it under
`import.meta.env.DEV`.

## Tool group

Group name: `al-yo-bo`.

| Name | Purpose |
| --- | --- |
| `get_search_state` | Current search query, filters, sort, pagination, result counts. |
| `list_visible_bookmarks` | IDs + summary of bookmarks currently rendered in the active view slice. |
| `get_bookmark` | One bookmark record by id (id, url, title, tags with provenance, scrape status, etc.). |
| `list_active_vocabulary` | Active tag + category vocabulary with usage counts. |

All tools read from the live TanStack Query cache via
`window.__al_yo_bo_qc` (set in `main.tsx` under `import.meta.env.DEV`).
Each call returns a JSON-serializable snapshot — no class instances, no
functions.

## Setup (one-time)

1. Edit `.opencode/opencode.jsonc` — the `chrome-devtools` entry's `args`
   array — and add `--categoryExperimentalThirdParty=true`:

   ```diff
   - "command": ["bunx", "-y", "chrome-devtools-mcp@latest", "--isolated"],
   + "command": ["bunx", "-y", "chrome-devtools-mcp@latest", "--isolated", "--categoryExperimentalThirdParty=true"],
   ```

2. Restart opencode to pick up the MCP config change.
3. `bun run dev` — Vite serves the web app, the devtools listener attaches
   on first `devtoolstooldiscovery` event from the MCP server (which fires
   on every `new_page` / `navigate_page`).

## Verify

In an opencode session with chrome-devtools-mcp available:

1. Start the dev server (`bun run dev`) and open the page with
   `new_page`.
2. Call `list_3p_developer_tools` — the `al-yo-bo` group should appear with
   four tools.
3. Drive the app to a non-trivial state (type a search, pick a tag, switch
   sort) and call `get_search_state` to confirm the snapshot matches.
4. `list_visible_bookmarks` should return a small payload (IDs + summary).
5. `get_bookmark` with a real id returns the record; with a bogus id
   returns `{ ok: false, error: 'not_found' }`.

## Architecture

```
apps/web/src/devtools/
  types.ts          Inlined ToolDefinition / ToolGroup / event types.
  client.ts         Window-bridged QueryClient handoff (DEV-only).
  cache.ts          latestListQuery(): most-recent list query helper.
  tools/
    search.ts       get_search_state
    bookmarks.ts    list_visible_bookmarks, get_bookmark
    vocabulary.ts   list_active_vocabulary
  register.ts       Listens for devtoolstooldiscovery, advertises the group.
  README.md         This file.
```

### State sources

- **Search state** — read from the queryKey of the most recently updated
  TanStack query under `queryKeys.bookmarks.list` (`App.tsx` constructs the
  queryKey from its own `useState` slots). No `App.tsx` changes needed.
- **Visible bookmarks** — `data.items` of that same list query.
- **Vocabulary** — `queryKeys.tags` joined with `queryKeys.aggregates` for
  usage counts; `queryKeys.categories` for the tree (flattened).

The "latest" list query is the one with the most recent `dataUpdatedAt` —
i.e. the page the user is currently looking at. Pagination, filters, and
sort all change that queryKey, so the helper naturally tracks navigation.

## Extending

To add a tool:

1. Create `apps/web/src/devtools/tools/<name>.ts` exporting a
   `ToolDefinition` (`name`, `description` ≤ 12 words, `inputSchema`,
   `execute`).
2. Import + add it to the `TOOL_GROUP.tools` array in `register.ts`.
3. Run `bun run typecheck` and `bun run lint`.
4. Reload the page (Vite HMR will pick up the change); call
   `list_3p_developer_tools` to confirm the new tool is registered.

Keep tool descriptions short — every chrome-devtools-mcp session loads the
group into its system prompt, so the cost is per-session, not per-call.

## Caveats

- **Experimental API.** chrome-devtools-mcp's third-party tools are gated
  behind a flag and the surface may change.
- **DEV-only.** The devtools tree is excluded from prod via the
  `import.meta.env.DEV` guard in `main.tsx` and the static
  `void import('@/devtools/register.ts')` is dropped at build time. To
  verify, build the app and confirm `apps/web/dist/assets/*.js` does not
  contain `devtoolstooldiscovery`.
- **Scope.** Tools only see what the user can see. `get_bookmark` for a
  bookmark that isn't in any cached list returns `not_found` — narrow the
  search via `get_search_state` first.
- **Security.** All tools execute in the page context. They cannot
  escalate privileges; they only read state the page already has.
