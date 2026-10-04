/**
 * Chat (ARCHITECTURE §2): AI SDK `streamText` backed by the local Ollama daemon,
 * with one tool — `searchBookmarks` — that queries the same search path as the
 * API, so answers cite real bookmarks.
 *
 * Chat is optional (§1.3/§1.5): without `OLLAMA_CHAT_MODEL` the route answers
 * 503; with Ollama unreachable, the error surfaces as an error part in the UI
 * message stream and the rest of the app is unaffected.
 */

import type { Context } from 'hono';
import { convertToModelMessages, isStepCount, streamText, tool, type UIMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { z } from 'zod';

import { ChatUnavailableError, type BookmarkHit } from '@al-yo-bo/core';

import type { ServerConfig } from './env.ts';

export interface ChatToolContext {
  config: ServerConfig;
  /** Runs the hybrid search path and returns compact hits (max `limit`). */
  search: (query: string, limit: number) => Promise<BookmarkHit[]>;
}

const MAX_SEARCH_HITS = 8;

const SYSTEM_PROMPT = `You are the al-yo-bo assistant, helping the user with their personal bookmark library.
Before answering any question about bookmarks, call the searchBookmarks tool with a short free-text query.
Base your answers on the tool results and cite bookmarks by their title and URL.
If the search returns nothing relevant, say so plainly — never invent bookmarks.
Be concise.`;

const searchBookmarksInputSchema = z.object({
  query: z.string().describe('Free-text search query, e.g. "rust async runtime"'),
});

export interface ChatHandlerOptions extends ChatToolContext {
  maxSteps?: number;
}

/**
 * Builds the Hono handler for `POST /api/chat`. Returns plain `Response`
 * objects (the UI message stream), so it mounts on any Hono chain.
 */
export function createChatHandler(options: ChatHandlerOptions) {
  const { config, search, maxSteps = 6 } = options;
  const chatModel = config.ai.ollama.chatModel;

  return async (c: Context): Promise<Response> => {
    if (!chatModel) {
      // Domain error, mapped to 503 problem+json by app.onError (errors.ts) —
      // same shape the old hand-rolled body produced, without bypassing the
      // central mapping.
      throw new ChatUnavailableError('Chat is not configured (set OLLAMA_CHAT_MODEL)');
    }

    let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
    try {
      const body = (await c.req.json()) as { messages?: unknown };
      if (!Array.isArray(body.messages)) {
        throw new Error('messages must be an array');
      }
      // Shape-check the UI messages here too: malformed parts throw inside
      // convertToModelMessages, which would otherwise surface as a 500.
      modelMessages = await convertToModelMessages(body.messages as UIMessage[]);
    } catch {
      return c.json(
        {
          type: 'https://al-yo-bo.local/problems/validation',
          title: 'Request body must be { messages: UIMessage[] }',
          status: 400,
        },
        400,
      );
    }

    const ollama = createOllama({
      baseURL: `${config.ai.ollama.url.replace(/\/$/, '')}/api`,
    });

    const result = streamText({
      model: ollama(chatModel),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      stopWhen: isStepCount(maxSteps),
      tools: {
        searchBookmarks: tool({
          description:
            'Search the user’s bookmark library. Always use this before answering questions about bookmarks.',
          inputSchema: searchBookmarksInputSchema,
          execute: async ({ query }) => {
            const hits = await search(query, MAX_SEARCH_HITS);
            return { query, total: hits.length, bookmarks: hits };
          },
        }),
      },
      onError: ({ error }) => {
        console.warn('[chat] stream error', error);
      },
    });

    return result.toUIMessageStreamResponse();
  };
}
