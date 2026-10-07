import { afterEach, describe, expect, test } from 'bun:test';

import { parseAiConfig } from '../src/config.ts';
import { createAiHealth } from '../src/health.ts';

const servers: Array<{ stop(): void }> = [];

function serve(handler: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return server.url.href;
}

/** A loopback port nothing listens on — connections are refused immediately. */
const DEAD_URL = 'http://127.0.0.1:1';

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
});

describe('createAiHealth', () => {
  test('reports degrade flags for a bare config (everything off)', async () => {
    const health = createAiHealth(parseAiConfig({ OLLAYA_URL: DEAD_URL, OLLAMA_URL: DEAD_URL }));

    const report = await health.report();

    expect(report.ollayaReachable).toBe(false);
    expect(report.ollamaReachable).toBe(false);
    expect(report.chatAvailable).toBe(false);
    expect(report.chatModel).toBeNull();
    expect(report.embeddingsConfigured).toBe(false);
    // No active embedding route → no model id is reported (keyword-only, §6).
    expect(report.embeddingModel).toBeNull();
    expect(report.classifierModel).toBe('laya');
    expect(report.extractConfigured).toBe(false);
    expect(report.extractModel).toBeNull();
  });

  test('probes both daemons; an answering 4xx still counts as reachable', async () => {
    const ollayaUrl = serve(() => new Response('unauthorized', { status: 401 }));
    const ollamaUrl = serve(() => new Response('Ollama is running'));
    const health = createAiHealth(
      parseAiConfig({
        OLLAYA_URL: ollayaUrl,
        OLLAMA_URL: ollamaUrl,
        OLLAMA_CHAT_MODEL: 'llama3.2',
      }),
    );

    const report = await health.report();

    expect(report.ollayaReachable).toBe(true);
    expect(report.ollamaReachable).toBe(true);
    // Chat capability is the configured model — a down daemon surfaces an
    // in-stream error instead (§12), it does not flip this flag.
    expect(report.chatAvailable).toBe(true);
    expect(report.chatModel).toBe('llama3.2');
  });

  test('probes are TTL-cached within one health instance', async () => {
    let hits = 0;
    const ollayaUrl = serve(() => {
      hits += 1;
      return new Response('ok');
    });
    const health = createAiHealth(parseAiConfig({ OLLAYA_URL: ollayaUrl, OLLAMA_URL: DEAD_URL }));

    await health.report();
    const second = await health.report();

    expect(hits).toBe(1);
    expect(second.ollayaReachable).toBe(true);
  });

  test('extraction flags follow the EXTRACT_MODEL route (production engages OpenRouter)', async () => {
    const health = createAiHealth(
      parseAiConfig({
        OPENROUTER_API_KEY: 'k',
        NODE_ENV: 'production',
        OLLAYA_URL: DEAD_URL,
        OLLAMA_URL: DEAD_URL,
      }),
    );

    const report = await health.report();

    expect(report.embeddingsConfigured).toBe(true);
    expect(report.embeddingModel).toBe('openai/text-embedding-3-small');
    expect(report.extractConfigured).toBe(true);
    expect(report.extractModel).toBe('deepseek/deepseek-v4.1-flash');
  });

  test('dev embeddings follow the OLLAMA_EMBED_MODEL route without production', async () => {
    const health = createAiHealth(
      parseAiConfig({ OLLAMA_EMBED_MODEL: 'nomic-embed-text', OLLAYA_URL: DEAD_URL, OLLAMA_URL: DEAD_URL }),
    );

    const report = await health.report();

    expect(report.embeddingsConfigured).toBe(true);
    expect(report.embeddingModel).toBe('nomic-embed-text');
  });
});
