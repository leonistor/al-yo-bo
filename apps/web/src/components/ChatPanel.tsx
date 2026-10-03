import { useChat } from '@ai-sdk/react';
import type { BookmarkWithTags } from '@al-yo-bo/shared';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIDataTypes,
  type UIMessage,
} from 'ai';
import { Check, Copy, MessageSquareIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AgentActivity, type AgentActivityItem } from '@/components/agents/agent-activity';
import { MarkdownContent } from '@/components/agents/markdown-content';
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageFooter,
  MessageTyping,
} from '@/components/agents/message';
import { MessageScroller } from '@/components/agents/message-scroller';
import { PromptInput } from '@/components/agents/prompt-input';
import { StreamingResponse } from '@/components/agents/streaming-response';
import { CompactBookmarkCard } from '@/components/CompactBookmarkCard';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

/**
 * One `searchBookmarks` hit as returned by `POST /api/chat` (ARCHITECTURE §2).
 * The server sends `BookmarkHit`s, so `updatedAt` is present at runtime even
 * though the tool's citation payload only advertises the display fields.
 */
interface SearchBookmarkHit {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  tags?: string[];
  categoryName?: string | null;
  updatedAt?: number;
}

interface SearchBookmarksResult {
  query?: string;
  total?: number;
  bookmarks?: SearchBookmarkHit[];
}

/** UI tool map for `useChat`, so tool parts narrow to typed input/output. */
type ChatTools = {
  searchBookmarks: { input: { query: string }; output: SearchBookmarksResult };
};
type ChatMessage = UIMessage<unknown, UIDataTypes, ChatTools>;
type ChatPart = ChatMessage['parts'][number];

/**
 * Concatenates a message's text parts (user prompts have exactly one). Models
 * commonly emit leading/trailing newlines, which `whitespace-pre-wrap` would
 * render as blank space at the bubble edges — trim them.
 */
function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part): part is Extract<ChatPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim();
}

/**
 * Adapts a compact chat hit to the bookmark view model so the tool-result
 * surface renders through `CompactBookmarkCard` (DESIGN.md §Chat). Missing
 * scrape metadata degrades to the tile's placeholder thumbnail.
 */
function toBookmarkWithTags(hit: SearchBookmarkHit): BookmarkWithTags {
  return {
    id: hit.id,
    datasetId: '',
    url: hit.url,
    title: hit.title,
    description: hit.description,
    content: null,
    metadata: null,
    categoryId: null,
    contentHash: null,
    scrapedAt: null,
    status: 'active',
    scrapeAttempts: 0,
    createdAt: hit.updatedAt ?? 0,
    updatedAt: hit.updatedAt ?? 0,
    tags: (hit.tags ?? []).map((name) => ({
      tagId: name,
      name,
      source: 'import',
      confidence: null,
    })),
  };
}

/**
 * Converts search hits into a compact markdown citation list. The title is
 * preferred; raw URL is used as fallback for untitled bookmarks.
 */
function toCitationMarkdown(hits: SearchBookmarkHit[]): string {
  return hits.map((hit) => `- [${hit.title ?? hit.url}](${hit.url})`).join('\n');
}

/**
 * Collects bookmark hits from the `searchBookmarks` tool parts inside a single
 * assistant message. Tool errors or in-flight calls contribute nothing.
 */
function searchBookmarksHits(message: ChatMessage): SearchBookmarkHit[] {
  const hits: SearchBookmarkHit[] = [];
  for (const part of message.parts) {
    if (part.type === 'tool-searchBookmarks' && part.state === 'output-available') {
      hits.push(...(part.output.bookmarks ?? []));
    }
  }
  return hits;
}

/**
 * Fallback when an assistant message carries no tool results of its own:
 * walk backward through the conversation and return the most recent
 * `searchBookmarks` hits. This is the closest client-side approximation to
 * per-answer citations because the AI SDK stream does not explicitly link an
 * answer to the sources it used.
 */
function latestSearchBookmarksHits(messages: ChatMessage[]): SearchBookmarkHit[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    const hits = searchBookmarksHits(message);
    if (hits.length > 0) return hits;
  }
  return [];
}

/** Icon-only copy control; state is exposed to screen readers via aria-label. */
function CopyMessageButton({ text }: { text: string }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const handleCopy = useCallback(() => copyToClipboard(text), [copyToClipboard, text]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={isCopied ? 'Message copied' : 'Copy message'}
      onClick={handleCopy}
    >
      {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

/**
 * Renders the `searchBookmarks` tool lifecycle: a live agent-activity row while
 * the search runs, then the hits as compact tiles. Chat is a view, never a
 * second library — a tile's primary action opens the URL externally, and
 * curation (tags, deletion) happens in the library surfaces.
 */
function SearchBookmarksTool({ part }: { part: Extract<ChatPart, { type: 'tool-searchBookmarks' }> }) {
  const query = part.input?.query ?? '';
  const items = useMemo<AgentActivityItem[]>(
    () => [{ id: part.toolCallId, type: 'search', query: query || 'your bookmarks' }],
    [part.toolCallId, query],
  );

  const openBookmark = useCallback((bookmark: BookmarkWithTags) => {
    window.open(bookmark.url, '_blank', 'noopener,noreferrer');
  }, []);

  if (part.state === 'output-error') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
      >
        Couldn’t search your bookmarks. You can keep chatting and try again.
      </div>
    );
  }

  if (part.state !== 'output-available') {
    return (
      <AgentActivity
        items={items}
        status="working"
        activeLabel="Searching your bookmarks…"
        maxHeight={160}
      />
    );
  }

  const hits = part.output.bookmarks ?? [];
  const total = part.output.total ?? hits.length;

  return (
    <div className="flex w-full flex-col gap-2">
      <AgentActivity
        items={items}
        status="complete"
        summary={
          total === 1 ? 'Searched your bookmarks — 1 match' : `Searched your bookmarks — ${total} matches`
        }
        maxHeight={160}
      />
      {hits.length > 0 ? (
        <ul className="grid w-full grid-cols-2 gap-2" aria-label="Bookmarks found">
          {hits.map((hit) => (
            <li key={hit.id}>
              <CompactBookmarkCard
                bookmark={toBookmarkWithTags(hit)}
                onOpen={openBookmark}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">No bookmarks found.</p>
      )}
    </div>
  );
}

function AssistantParts({
  message,
  messages,
  streaming,
}: {
  message: ChatMessage;
  messages: ChatMessage[];
  streaming: boolean;
}) {
  // The assistant answers only after running the search tool, so tool rows
  // render above the response; the streamed answer itself goes through
  // streaming-response with the completion actions.
  const tools = message.parts.filter(
    (part): part is Extract<ChatPart, { type: 'tool-searchBookmarks' }> =>
      part.type === 'tool-searchBookmarks',
  );
  const text = messageText(message);

  const citeHits = useMemo(() => {
    const hits = searchBookmarksHits(message);
    if (hits.length > 0) return hits;
    return latestSearchBookmarksHits(messages);
  }, [message, messages]);

  const citeText = useMemo(() => toCitationMarkdown(citeHits), [citeHits]);

  const handleCite = useCallback(() => {
    if (!citeText || !navigator.clipboard) return;
    navigator.clipboard.writeText(citeText).then(
      () => toast.success('Citations copied'),
      () => toast.error('Couldn’t copy citations'),
    );
  }, [citeText]);

  return (
    <>
      {tools.map((part) => (
        <SearchBookmarksTool key={part.toolCallId} part={part} />
      ))}
      {text ? (
        <StreamingResponse
          status={streaming ? 'streaming' : 'complete'}
          copyText={text}
          onCite={citeText ? handleCite : undefined}
          // The scroller's `role="log"` live region announces streamed text.
          announce={false}
        >
          <MarkdownContent key={message.id}>{text}</MarkdownContent>
        </StreamingResponse>
      ) : null}
    </>
  );
}

function ChatMessageRow({
  message,
  messages,
  streaming,
}: {
  message: ChatMessage;
  messages: ChatMessage[];
  streaming: boolean;
}) {
  const text = useMemo(() => messageText(message), [message]);

  if (message.role === 'user') {
    return (
      <Message from="user" animateIn>
        <MessageContent>
          <MessageBubble variant="solid">
            <MessageBubbleContent>
              <span className="whitespace-pre-wrap break-words">{text}</span>
            </MessageBubbleContent>
          </MessageBubble>
          <MessageFooter>
            <CopyMessageButton text={text} />
          </MessageFooter>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant" animateIn>
      <MessageContent>
        <MessageBubble variant="ghost">
          <MessageBubbleContent>
            <AssistantParts message={message} messages={messages} streaming={streaming} />
          </MessageBubbleContent>
        </MessageBubble>
      </MessageContent>
    </Message>
  );
}

/** Calm empty state shown before the first prompt. */
function ChatEmptyState() {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
      <MessageSquareIcon className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">Ask about your bookmarks</p>
      <p className="text-xs text-muted-foreground">
        Search your library in plain language — results appear as cards you can open.
      </p>
    </div>
  );
}

/**
 * Chat is optional (ARCHITECTURE §1.3): a missing model (503) or an unreachable
 * Ollama surfaces here without hiding the transcript or locking the composer.
 */
function ChatErrorNotice() {
  return (
    <div
      role="alert"
      className="mx-2 mb-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
    >
      <p className="font-medium text-foreground">Chat is unavailable right now.</p>
      <p className="mt-0.5">Your library still works — try again once the assistant is back.</p>
    </div>
  );
}

/**
 * Right-hand chat panel (README: chat "without losing your place in the UI").
 * Talks to the server's `/api/chat` (AI SDK UI message stream; Ollama-backed)
 * and renders on beui primitives (DESIGN.md §Chat).
 */
export function ChatPanel() {
  // Stable across renders: recreating the transport would rebuild the chat
  // instance and drop in-progress state.
  const transport = useMemo(
    () => new DefaultChatTransport<ChatMessage>({ api: '/api/chat' }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat<ChatMessage>({
    transport,
    // Tool results are sent back automatically so the model can answer after
    // searching (AI SDK multi-step).
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const [input, setInput] = useState('');
  const rootRef = useRef<HTMLElement>(null);

  // Focus the composer on mount (the previous surface's behavior). A ref-based
  // focus keeps the mount focus without the `autoFocus` attribute, which is a
  // usability flag for sighted keyboard users.
  useEffect(() => {
    rootRef.current?.querySelector('textarea')?.focus();
  }, []);

  const isBusy = status === 'submitted' || status === 'streaming';
  const streamingMessageId =
    isBusy
      ? messages.findLast((message) => message.role === 'assistant')?.id ?? null
      : null;

  const handleSubmit = useCallback(
    (value: string) => {
      void sendMessage({ text: value });
      setInput('');
    },
    [sendMessage, setInput],
  );

  return (
    <section ref={rootRef} aria-label="Assistant chat" className="flex h-full min-h-0 flex-col">
      <MessageScroller className="min-h-0 flex-1" label="Conversation" busy={isBusy}>
        {messages.length === 0 ? (
          <ChatEmptyState />
        ) : (
          <div className="flex flex-col gap-4 px-3 py-4">
            {messages.map((message) => (
              <ChatMessageRow
                key={message.id}
                message={message}
                messages={messages}
                streaming={message.id === streamingMessageId}
              />
            ))}
            {status === 'submitted' && (
              <Message from="assistant" animateIn>
                <MessageContent>
                  <div className="px-1 text-muted-foreground">
                    <MessageTyping label="Thinking" />
                  </div>
                </MessageContent>
              </Message>
            )}
          </div>
        )}
      </MessageScroller>

      {error && <ChatErrorNotice />}

      <div className="shrink-0 border-t border-border p-2">
        <PromptInput
          value={input}
          onValueChange={setInput}
          onSubmit={handleSubmit}
          loading={isBusy}
          onStop={stop}
          disabled={isBusy}
          minRows={1}
          maxRows={6}
          placeholder="Ask about your bookmarks…"
          aria-label="Message the assistant"
        />
      </div>
    </section>
  );
}
