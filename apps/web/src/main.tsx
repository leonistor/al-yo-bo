import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';

import { App } from './App.tsx';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
// DEV-only: hand the live TanStack Query client to the devtools module so its
// tools can read the cache at execute-time. The dynamic import is the entire
// devtools tree (./devtools/register.ts) — Vite drops it from prod when
// `import.meta.env.DEV` is replaced with `false` at build time.
import { setQueryClientForDevtools } from '@/devtools/client.ts';
/* eslint-disable import/no-unassigned-import -- global CSS side-effect import */
import './index.css';
/* eslint-enable import/no-unassigned-import */

// Dev-only annotation toolbar (visual feedback for AI coding agents; see
// docs/UI-ANNOTATION-TOOLING.md). Mounted only when the stack runs with
// `--annotate` (scripts/dev.sh exports VITE_ANNOTATE=1) — plain `bun run dev`
// shows no toolbar. The static DEV guard still lets Vite fold the dynamic
// import away in production builds, so it never ships.
const Agentation =
  import.meta.env.DEV && import.meta.env.VITE_ANNOTATE === '1'
    ? lazy(() => import('agentation').then((m) => ({ default: m.Agentation })))
    : null;

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // Fires after retries are exhausted, replacing the per-fetch toast.error
    // the manual refresh callbacks used to raise.
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to load data');
    },
  }),
  defaultOptions: {
    queries: {
      // Server data changes only through user actions in this app, so 30s of
      // freshness avoids refetch storms across remounts; mutations invalidate.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

if (import.meta.env.DEV) {
  setQueryClientForDevtools(queryClient);
  void import('@/devtools/register.ts').then((m) => m.registerDevtools());
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
        <Toaster position="bottom-right" />
        {Agentation && (
          <Suspense fallback={null}>
            <Agentation appName="al-yo-bo" endpoint="http://localhost:4747" />
          </Suspense>
        )}
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);