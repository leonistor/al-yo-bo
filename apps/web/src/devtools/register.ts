/**
 * Dev-only entrypoint. Listens for chrome-devtools-mcp's
 * `devtoolstooldiscovery` event and advertises a `ToolGroup` of al-yo-bo
 * internal-state readers. The MCP server invokes tools through this group;
 * each tool's `execute()` returns a JSON-serializable snapshot of the
 * matching TanStack Query cache entry.
 *
 * Loaded only behind `import.meta.env.DEV` in `main.tsx`, so the entire
 * `devtools/` directory is excluded from the production bundle.
 *
 * Restart opencode after editing `.opencode/opencode.jsonc` to pick up the
 * `--categoryExperimentalThirdParty=true` flag.
 */
import type { DevtoolsToolDiscoveryEvent, ToolGroup } from './types.ts';
import { getBookmark, listVisibleBookmarks } from './tools/bookmarks.ts';
import { getSearchState } from './tools/search.ts';
import { listActiveVocabulary } from './tools/vocabulary.ts';

const TOOL_GROUP: ToolGroup = {
  name: 'al-yo-bo',
  description:
    'Internal al-yo-bo state: active search/filter, visible bookmarks, vocabulary. ' +
    'DEV-only. Source of truth is the TanStack Query cache; results reflect ' +
    'the user\u2019s current page slice.',
  tools: [getSearchState, listVisibleBookmarks, getBookmark, listActiveVocabulary],
};

export function registerDevtools(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.addEventListener('devtoolstooldiscovery', (event: DevtoolsToolDiscoveryEvent) => {
    event.respondWith(TOOL_GROUP);
  });
}
