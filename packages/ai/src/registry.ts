/**
 * Explicit provider registry (ARCHITECTURE §8). Provider instances are built
 * only from the central `AiConfig` — there is no ambient default provider
 * reading its own env vars, so a stray `OPENAI_API_KEY` can never route a call
 * anywhere unexpected. Concrete model objects are handed to the AI SDK by the
 * adapters; `null` slots mean "not configured" and degrade the feature (§1.5).
 */

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { createOllama, type OllamaProvider } from 'ollama-ai-provider-v2';

export interface RegistryProviders {
  /** OpenRouter (OpenAI-compatible API). Omitted when `OPENROUTER_API_KEY` is unset. */
  openrouter?: {
    apiKey: string;
    baseUrl?: string;
  };
  /**
   * Local Ollama daemon (native API base, e.g. `http://127.0.0.1:11434/api` —
   * the provider appends `/chat`, `/generate`, `/embed`). Omitted when the
   * daemon is not configured.
   */
  local?: {
    baseUrl: string;
  };
}

export interface ProviderRegistry {
  /** OpenRouter provider, or `null` when no key is configured. */
  readonly openrouter: OpenAICompatibleProvider | null;
  /** Local Ollama provider, or `null` when no daemon URL is configured. */
  readonly local: OllamaProvider | null;
}

/**
 * Build explicit AI SDK provider instances. Called once by `buildAiLayer`
 * (consumed only by apps/server, ARCHITECTURE §4).
 */
export function createProviderRegistry(providers: RegistryProviders): ProviderRegistry {
  return {
    openrouter: providers.openrouter
      ? createOpenAICompatible({
          name: 'openrouter',
          apiKey: providers.openrouter.apiKey,
          baseURL: providers.openrouter.baseUrl ?? 'https://openrouter.ai/api/v1',
        })
      : null,
    local: providers.local ? createOllama({ baseURL: providers.local.baseUrl }) : null,
  };
}
