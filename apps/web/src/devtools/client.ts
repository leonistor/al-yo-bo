/**
 * Tiny bridge so the devtools module can read the live TanStack Query cache
 * (bookmarks, tags, categories, aggregates) without React context or a hook.
 *
 * `main.tsx` calls `setQueryClientForDevtools(queryClient)` behind
 * `import.meta.env.DEV`. The devtools tools then call `getQueryClient()` at
 * execute time, so each tool invocation sees fresh data without re-renders.
 *
 * The window assignment is dead code in production: Vite replaces
 * `import.meta.env.DEV` with `false` at build time, the call is dropped, and
 * the unused export is tree-shaken — no runtime cost, no devtools surface in
 * the prod bundle.
 */
import type { QueryClient } from '@tanstack/react-query';

declare global {
  interface Window {
    alYoBoDevtoolsQc?: QueryClient;
  }
}

export function setQueryClientForDevtools(client: QueryClient): void {
  if (typeof window !== 'undefined') {
    window.alYoBoDevtoolsQc = client;
  }
}

export function getQueryClient(): QueryClient | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.alYoBoDevtoolsQc ?? null;
}
