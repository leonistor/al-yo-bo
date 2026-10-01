import { AssistantRuntimeProvider, makeAssistantToolUI } from '@assistant-ui/react';
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/ai-sdk';
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai';

import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { Badge } from '@/components/ui/badge';
import { hostOf } from '@/lib/format';

interface SearchBookmarksResult {
  query?: string;
  total?: number;
  bookmarks?: Array<{
    id: string;
    url: string;
    title: string | null;
    description: string | null;
    tags?: string[];
    categoryName?: string | null;
  }>;
}

/** Renders the chat tool's hits as compact, clickable bookmark cards (DESIGN.md §Chat). */
const SearchBookmarksUI = makeAssistantToolUI<Record<string, unknown>, SearchBookmarksResult>({
  toolName: 'searchBookmarks',
  render: ({ result }) => {
    const hits = result?.bookmarks ?? [];
    if (hits.length === 0) {
      return <p className="px-1 py-2 text-sm text-muted-foreground">No bookmarks found.</p>;
    }
    return (
      <ul className="flex flex-col gap-1.5 px-1 py-2" aria-label="Search results">
        {hits.map((hit) => (
          <li key={hit.id}>
            <a
              href={hit.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-border/60 px-2.5 py-1.5 transition-colors hover:bg-accent"
            >
              <span className="line-clamp-1 text-sm font-medium">{hit.title ?? hostOf(hit.url)}</span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{hostOf(hit.url)}</span>
              {(hit.tags?.length ?? 0) > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {hit.tags!.slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[0.65rem]">
                      {tag}
                    </Badge>
                  ))}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    );
  },
});

/**
 * Right-hand chat panel (README: chat "without losing your place in the UI").
 * Talks to the server's `/api/chat` (AI SDK UI message stream; Ollama-backed).
 */
export function ChatPanel() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: '/api/chat' }),
    // Tool results are sent back automatically so the model can answer after
    // searching (AI SDK multi-step).
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SearchBookmarksUI />
      <div className="h-full min-h-0 overflow-hidden" aria-label="Assistant chat">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
