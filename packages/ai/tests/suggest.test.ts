import { afterEach, describe, expect, test } from 'bun:test';

import { createSuggestClient } from '../src/adapters/suggest.ts';
import { parseAiConfig } from '../src/config.ts';
import { suggestPrompt } from '../src/suggest.ts';

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

function sampleInput(): import('../src/suggest.ts').SuggestInput {
  return {
    devProfile: {
      source: 'github',
      focus: 'web frontend',
      languages: ['typescript', 'rust'],
      frameworks: ['react', 'tailwindcss'],
      tools: ['vite'],
      experience: 'senior',
      notes: 'prefers minimal tooling',
    },
    existing: {
      tags: ['javascript'],
      categoryPaths: [['dev', 'web']],
    },
  };
}

/** A vocabulary payload as the model would emit it inside the JSON content. */
function vocabularyJson(): string {
  return JSON.stringify({
    tags: [
      { name: 'react', description: 'React library' },
      { name: 'typescript' },
    ],
    categories: [
      { path: ['dev', 'frontend'], description: 'Frontend development' },
      { path: ['tools', 'build'] },
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

describe('suggestPrompt', () => {
  test('embeds the developer profile and existing vocabulary', () => {
    const prompt = suggestPrompt(sampleInput());
    expect(prompt.startsWith('Suggest a personal vocabulary')).toBe(true);
    expect(prompt).toContain('react');
    expect(prompt).toContain('typescript');
    expect(prompt).toContain('javascript');
    expect(prompt).toContain('["dev","web"]');
  });

  test('states dedupe and size rules', () => {
    const prompt = suggestPrompt(sampleInput());
    expect(prompt).toContain('Dedupe against the existing tags');
    expect(prompt).toContain('10-40 tags');
    expect(prompt).toContain('5-15 category paths');
  });
});

describe('createSuggestClient', () => {
  test('returns null when no provider is configured', () => {
    expect(createSuggestClient(parseAiConfig({}))).toBeNull();
  });

  test('suggests through OpenRouter and returns parsed vocabulary', async () => {
    let sawPath = '';
    const baseUrl = serve((request) => {
      sawPath = new URL(request.url).pathname;
      return openRouterResponse(vocabularyJson());
    });
    const client = createSuggestClient(
      parseAiConfig({
        OPENROUTER_API_KEY: 'k',
        OPENROUTER_BASE_URL: baseUrl,
        EXTRACT_MODEL: 'test/model',
        OLLAMA_URL: 'http://127.0.0.1:1',
      }),
    );

    const result = await client!.suggest(sampleInput());

    expect(sawPath).toBe('/chat/completions');
    expect(result).toEqual({
      tags: [
        { name: 'react', description: 'React library' },
        { name: 'typescript' },
      ],
      categories: [
        { path: ['dev', 'frontend'], description: 'Frontend development' },
        { path: ['tools', 'build'] },
      ],
    });
  });

  test('suggests through the local Ollama path', async () => {
    let sawPath = '';
    const ollamaUrl = serve((request) => {
      sawPath = new URL(request.url).pathname;
      return ollamaResponse(vocabularyJson());
    });
    const client = createSuggestClient(
      parseAiConfig({ OLLAMA_URL: ollamaUrl, EXTRACT_MODEL: 'llama3.2' }),
    );

    const result = await client!.suggest(sampleInput());

    // The provider speaks the native API under /api.
    expect(sawPath).toBe('/api/chat');
    expect(result).not.toBeNull();
    expect(result!.tags).toHaveLength(2);
    expect(result!.categories[0]?.path).toEqual(['dev', 'frontend']);
  });

  test('a failed LLM call degrades to null', async () => {
    const baseUrl = serve(() => new Response('oops', { status: 500 }));
    const client = createSuggestClient(
      parseAiConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: baseUrl }),
    );

    const result = await client!.suggest(sampleInput());

    expect(result).toBeNull();
  });

  test('a non-JSON model reply degrades to null (no silent garbage)', async () => {
    const baseUrl = serve(() => openRouterResponse('not json at all'));
    const client = createSuggestClient(
      parseAiConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: baseUrl }),
    );

    const result = await client!.suggest(sampleInput());

    expect(result).toBeNull();
  });
});
