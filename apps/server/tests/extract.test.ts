import { describe, expect, test } from 'bun:test';

import { loadConfig } from '../src/env.ts';
import {
  buildExtractionClient,
  resolveExtractConfig,
  resolveExtractModel,
} from '../src/extract.ts';

/**
 * `EXTRACT_MODEL` is threaded through `ServerConfig` (not `process.env`), so the
 * resolution is testable by loading config from an explicit env object. The
 * precedence chain (ARCHITECTURE §7): EXTRACT_MODEL -> OpenRouter default when a
 * key is set -> Ollama chat model -> deterministic parser.
 */
function configFrom(env: Record<string, string | undefined>) {
  // Keep the data-dir resolution deterministic and self-contained.
  return loadConfig({ DATA_DIR: '/tmp/al-yo-bo-extract-test', ...env });
}

describe('resolveExtractModel', () => {
  test('EXTRACT_MODEL wins over everything', () => {
    const config = configFrom({
      EXTRACT_MODEL: 'mistral',
      OPENROUTER_API_KEY: 'sk-test',
      OLLAMA_CHAT_MODEL: 'llama3',
    });
    expect(resolveExtractModel(config)).toBe('mistral');
  });

  test('falls back to the OpenRouter default when a key is set', () => {
    const config = configFrom({ OPENROUTER_API_KEY: 'sk-test', OLLAMA_CHAT_MODEL: 'llama3' });
    expect(resolveExtractModel(config)).toBe('deepseek/deepseek-v4.1-flash');
  });

  test('falls back to the Ollama chat model without an OpenRouter key', () => {
    const config = configFrom({ OLLAMA_CHAT_MODEL: 'llama3' });
    expect(resolveExtractModel(config)).toBe('llama3');
  });

  test('returns null when nothing is configured', () => {
    const config = configFrom({});
    expect(resolveExtractModel(config)).toBeNull();
  });
});

describe('resolveExtractConfig', () => {
  test('non-slash EXTRACT_MODEL selects that model on the Ollama path', () => {
    const config = configFrom({
      EXTRACT_MODEL: 'mistral',
      OPENROUTER_API_KEY: 'sk-test',
      OLLAMA_CHAT_MODEL: 'llama3',
    });
    const extract = resolveExtractConfig(config);
    expect(extract.ollama.model).toBe('mistral');
    // A local id must never be sent to OpenRouter.
    expect(extract.openrouter.model).toBe('');
    expect(buildExtractionClient(config)).not.toBeNull();
  });

  test('slash EXTRACT_MODEL selects OpenRouter, chat model stays the Ollama fallback', () => {
    const config = configFrom({
      EXTRACT_MODEL: 'openai/gpt-4o-mini',
      OPENROUTER_API_KEY: 'sk-test',
      OLLAMA_CHAT_MODEL: 'llama3',
    });
    const extract = resolveExtractConfig(config);
    expect(extract.openrouter.model).toBe('openai/gpt-4o-mini');
    expect(extract.ollama.model).toBe('llama3');
  });

  test('unset EXTRACT_MODEL uses the OpenRouter default', () => {
    const config = configFrom({ OPENROUTER_API_KEY: 'sk-test' });
    const extract = resolveExtractConfig(config);
    expect(extract.openrouter.model).toBe('deepseek/deepseek-v4.1-flash');
    expect(extract.ollama.model).toBeNull();
  });

  test('no provider configured yields no extraction client', () => {
    const config = configFrom({});
    const extract = resolveExtractConfig(config);
    expect(extract.openrouter.model).toBe('');
    expect(extract.ollama.model).toBeNull();
    expect(buildExtractionClient(config)).toBeNull();
  });
});
