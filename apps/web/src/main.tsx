import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';

import { App } from './App.tsx';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';

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

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);