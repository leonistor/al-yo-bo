import { describe, expect, test } from 'bun:test';

import { parseAiConfig } from '../src/config.ts';

describe('parseAiConfig', () => {
  test('applies the ARCHITECTURE §8 defaults for absent variables', () => {
    const config = parseAiConfig({});

    expect(config.ollaya.url).toBe('http://127.0.0.1:11435');
    expect(config.ollaya.model).toBe('laya');
    expect(config.ollama.url).toBe('http://127.0.0.1:11434');
    expect(config.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.openrouter.embeddingModel).toBe('openai/text-embedding-3-small');
    expect(config.autoAssignThreshold).toBe(0.7);
    // Absent optionals stay undefined — never throw, never coerce.
    expect(config.ollaya.apiKey).toBeUndefined();
    expect(config.ollama.chatModel).toBeUndefined();
    expect(config.openrouter.apiKey).toBeUndefined();
    expect(config.extractModel).toBeUndefined();
    expect(config.mcpToken).toBeUndefined();
  });

  test('coerces the threshold and treats blank env values as unset', () => {
    expect(parseAiConfig({ AUTO_ASSIGN_THRESHOLD: '0.8' }).autoAssignThreshold).toBe(0.8);
    // A bare `AUTO_ASSIGN_THRESHOLD=` must not coerce to 0.
    expect(parseAiConfig({ AUTO_ASSIGN_THRESHOLD: '' }).autoAssignThreshold).toBe(0.7);
    expect(parseAiConfig({ AUTO_ASSIGN_THRESHOLD: '  ' }).autoAssignThreshold).toBe(0.7);
  });

  test('rejects present-but-invalid values (config error, not degradation)', () => {
    expect(() => parseAiConfig({ AUTO_ASSIGN_THRESHOLD: 'abc' })).toThrow();
    expect(() => parseAiConfig({ AUTO_ASSIGN_THRESHOLD: '1.5' })).toThrow();
  });

  test('passes optionals through and overrides defaults', () => {
    const config = parseAiConfig({
      OLLAYA_URL: 'http://127.0.0.1:21435/',
      OLLAYA_API_KEY: 'secret',
      OLLAYA_MODEL: 'laya-multilingual',
      OLLAMA_URL: 'http://127.0.0.1:21434',
      OLLAMA_CHAT_MODEL: 'llama3.2',
      OPENROUTER_API_KEY: 'or-key',
      OPENROUTER_BASE_URL: 'https://proxy.example.com/v1',
      EMBEDDING_MODEL: 'openai/text-embedding-3-large',
      EXTRACT_MODEL: 'qwen/qwen3-14b',
      MCP_TOKEN: 'mcp-secret',
    });

    expect(config.ollaya.url).toBe('http://127.0.0.1:21435/');
    expect(config.ollaya.apiKey).toBe('secret');
    expect(config.ollaya.model).toBe('laya-multilingual');
    expect(config.ollama.url).toBe('http://127.0.0.1:21434');
    expect(config.ollama.chatModel).toBe('llama3.2');
    expect(config.openrouter.apiKey).toBe('or-key');
    expect(config.openrouter.baseUrl).toBe('https://proxy.example.com/v1');
    expect(config.openrouter.embeddingModel).toBe('openai/text-embedding-3-large');
    expect(config.extractModel).toBe('qwen/qwen3-14b');
    expect(config.mcpToken).toBe('mcp-secret');
  });
});
