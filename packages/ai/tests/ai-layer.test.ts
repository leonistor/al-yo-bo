import { describe, expect, test } from 'bun:test';

import { buildAiLayer } from '../src/index.ts';
import { parseAiConfig } from '../src/config.ts';

describe('buildAiLayer', () => {
  test('suggest is present when an LLM provider is configured', () => {
    const layer = buildAiLayer(
      parseAiConfig({
        OPENROUTER_API_KEY: 'k',
        EXTRACT_MODEL: 'test/model',
      }),
    );

    expect(layer.suggest).not.toBeNull();
    expect(layer.extract).not.toBeNull();
  });

  test('suggest is absent when no LLM provider is configured', () => {
    const layer = buildAiLayer(parseAiConfig({}));

    expect(layer.suggest).toBeNull();
    expect(layer.extract).toBeNull();
  });

  test('suggest follows the Ollama path when OpenRouter is unavailable', () => {
    const layer = buildAiLayer(
      parseAiConfig({
        OLLAMA_URL: 'http://127.0.0.1:11434',
        OLLAMA_CHAT_MODEL: 'llama3.2',
      }),
    );

    expect(layer.suggest).not.toBeNull();
    expect(layer.extract).not.toBeNull();
  });

  test('embeddings follow the §8 route: dev Ollama, production OpenRouter, else keyword-only', () => {
    // Dev with a key stays keyword-only — OpenRouter is production-only (§8).
    const dev = buildAiLayer(parseAiConfig({ OPENROUTER_API_KEY: 'k' }));
    expect(dev.embeddings).toBeNull();

    // Dev with OLLAMA_EMBED_MODEL serves embeddings from the local daemon.
    const devLocal = buildAiLayer(parseAiConfig({ OLLAMA_EMBED_MODEL: 'nomic-embed-text' }));
    expect(devLocal.embeddings).not.toBeNull();

    // Production with a key engages OpenRouter (EMBEDDING_MODEL default).
    const prod = buildAiLayer(
      parseAiConfig({ OPENROUTER_API_KEY: 'k', NODE_ENV: 'production' }),
    );
    expect(prod.embeddings).not.toBeNull();
  });
});
