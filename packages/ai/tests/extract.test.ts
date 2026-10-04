import { afterEach, describe, expect, test } from 'bun:test';

import { createExtractionClient } from '../src/adapters/extract.ts';
import { parseAiConfig } from '../src/config.ts';
import {
  DEFAULT_OPENROUTER_EXTRACT_MODEL,
  extractionPrompt,
  resolveExtractionRoute,
} from '../src/extract.ts';

const servers: Array<{ stop(): void }> = [];

/** Starts an HTTP server whose `fetch` handler supplies the response. */
function serve(handler: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return server.url.href;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
});

/** An extraction payload as the model would emit it inside the JSON content. */
function bookmarksJson(): string {
  return JSON.stringify({
    bookmarks: [
      {
        url: 'https://example.com/x',
        title: 'X',
        description: null,
        categoryPath: ['dev', 'web'],
        tags: ['web'],
        priority: 1,
      },
    ],
  });
}

/** An OpenAI-compatible chat-completions response carrying the JSON content. */
function openRouterResponse(content: string): Response {
  return Response.json({
    id: 'chatcmpl-1',
    model: 'test/model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

/** A native Ollama `/api/chat` response carrying the JSON content. */
function ollamaResponse(content: string): Response {
  return Response.json({
    model: 'llama3.2',
    created_at: '2026-10-04T00:00:00Z',
    done: true,
    message: { role: 'assistant', content },
  });
}

describe('extractionPrompt', () => {
  test('embeds the input verbatim and states the hard rules', () => {
    const prompt = extractionPrompt('hello https://example.com');
    expect(prompt.startsWith("Extract bookmarks from the user's free-form text.")).toBe(true);
    expect(prompt).toContain('Never invent URLs.');
    expect(prompt.endsWith('Input:\n"""\nhello https://example.com\n"""')).toBe(true);
  });

  test('instructs the empty-input case', () => {
    expect(extractionPrompt('')).toContain('If the input is empty, output `{ "bookmarks": [] }`.');
  });

  test('prompt shape is stable (golden)', () => {
    expect(extractionPrompt('## dev\n\n- x: https://example.com/x\n')).toMatchSnapshot();
  });
});

describe('resolveExtractionRoute', () => {
  test('EXTRACT_MODEL with a slash selects OpenRouter', () => {
    const route = resolveExtractionRoute(
      parseAiConfig({ OPENROUTER_API_KEY: 'k', EXTRACT_MODEL: 'test/model' }),
    );
    expect(route).toEqual({
      openrouterModel: 'test/model',
      ollamaModel: null,
      prefersOpenRouter: true,
    });
  });

  test('a non-slash EXTRACT_MODEL selects the local Ollama path', () => {
    const route = resolveExtractionRoute(
      parseAiConfig({ OPENROUTER_API_KEY: 'k', EXTRACT_MODEL: 'llama3.2' }),
    );
    expect(route.openrouterModel).toBeNull();
    expect(route.ollamaModel).toBe('llama3.2');
    expect(route.prefersOpenRouter).toBe(false);
  });

  test('unset falls back to the OpenRouter default when a key is set', () => {
    const route = resolveExtractionRoute(parseAiConfig({ OPENROUTER_API_KEY: 'k' }));
    expect(route.openrouterModel).toBe(DEFAULT_OPENROUTER_EXTRACT_MODEL);
    expect(route.prefersOpenRouter).toBe(true);
  });

  test('unset falls back to OLLAMA_CHAT_MODEL without a key', () => {
    const route = resolveExtractionRoute(parseAiConfig({ OLLAMA_CHAT_MODEL: 'llama3.2' }));
    expect(route.openrouterModel).toBeNull();
    expect(route.ollamaModel).toBe('llama3.2');
    expect(route.prefersOpenRouter).toBe(false);
  });

  test('a slash model without a key degrades the OpenRouter slot', () => {
    const route = resolveExtractionRoute(
      parseAiConfig({ EXTRACT_MODEL: 'test/model', OLLAMA_CHAT_MODEL: 'llama3.2' }),
    );
    expect(route.openrouterModel).toBeNull();
    expect(route.ollamaModel).toBe('llama3.2');
  });

  test('nothing configured → no LLM path (deterministic parser)', () => {
    const route = resolveExtractionRoute(parseAiConfig({}));
    expect(route.openrouterModel).toBeNull();
    expect(route.ollamaModel).toBeNull();
  });
});

describe('createExtractionClient', () => {
  test('returns null when no provider is configured', () => {
    expect(createExtractionClient(parseAiConfig({}))).toBeNull();
  });

  test('extracts through OpenRouter and returns provider metadata', async () => {
    let sawPath = '';
    const baseUrl = serve((request) => {
      sawPath = new URL(request.url).pathname;
      return openRouterResponse(bookmarksJson());
    });
    const client = createExtractionClient(
      parseAiConfig({
        OPENROUTER_API_KEY: 'k',
        OPENROUTER_BASE_URL: baseUrl,
        EXTRACT_MODEL: 'test/model',
        OLLAMA_URL: 'http://127.0.0.1:1',
      }),
    );

    const result = await client!.extract('## dev\n\n- x: https://example.com/x\n');

    expect(sawPath).toBe('/chat/completions');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('test/model');
    expect(result.warnings).toEqual([]);
    expect(result.bookmarks).toEqual([
      {
        url: 'https://example.com/x',
        title: 'X',
        description: null,
        categoryPath: ['dev', 'web'],
        priority: 1,
        tags: ['web'],
      },
    ]);
  });

  test('extracts through the local Ollama path', async () => {
    let sawPath = '';
    const ollamaUrl = serve((request) => {
      sawPath = new URL(request.url).pathname;
      return ollamaResponse(bookmarksJson());
    });
    const client = createExtractionClient(
      parseAiConfig({ OLLAMA_URL: ollamaUrl, EXTRACT_MODEL: 'llama3.2' }),
    );

    const result = await client!.extract('- https://example.com/x\n');

    // The provider speaks the native API under /api.
    expect(sawPath).toBe('/api/chat');
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.2');
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0]?.categoryPath).toEqual(['dev', 'web']);
  });

  test('a failed LLM call throws so the caller falls back to the deterministic parser', async () => {
    const baseUrl = serve(() => new Response('oops', { status: 500 }));
    const client = createExtractionClient(
      parseAiConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: baseUrl }),
    );

    const failure = await client!.extract('hello').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe('ExtractionError');
    expect((failure as Error).message).toContain('LLM extraction failed (openrouter');
  });

  test('a non-JSON model reply surfaces as ExtractionError (no silent garbage)', async () => {
    const baseUrl = serve(() => openRouterResponse('not json at all'));
    const client = createExtractionClient(
      parseAiConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: baseUrl }),
    );

    const failure = await client!.extract('hello').catch((error: unknown) => error);

    expect((failure as Error).name).toBe('ExtractionError');
  });
});
