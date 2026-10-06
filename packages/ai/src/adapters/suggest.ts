/**
 * Concrete LLM vocabulary-suggestion adapter (ARCHITECTURE §7 stage 0):
 * AI SDK v7 `generateText` + `Output.object` against OpenRouter
 * (`@ai-sdk/openai-compatible`) or the local Ollama daemon
 * (`ollama-ai-provider-v2`). Constructed only by `buildAiLayer` (§4).
 *
 * Failures degrade to `null`: the wizard can fall back to manual vocabulary
 * creation (§1.5). This adapter reuses the `EXTRACT_MODEL` route — there is no
 * separate suggestion model.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOllama } from 'ollama-ai-provider-v2';

import type { AiConfig } from '../config.ts';
import { resolveExtractionRoute } from '../extract.ts';
import type { ProviderRegistry } from '../registry.ts';
import type { SuggestClient, SuggestInput, VocabularySuggestion } from '../suggest.ts';
import { suggestPrompt, vocabularySuggestionSchema } from '../suggest.ts';
import { generateStructured, ProviderCallError, type ProviderSlot } from './generate-structured.ts';

/** Per-request budget for the interactive setup wizard; failure → manual fallback. */
const SUGGEST_TIMEOUT_MS = 60_000;

/**
 * Build the suggestion client from the central config, resolving the
 * `EXTRACT_MODEL` route (OpenRouter primary, Ollama local — §8 table).
 * Returns `null` when no provider is configured; the wizard then skips
 * AI suggestions.
 */
export function createSuggestClient(config: AiConfig): SuggestClient | null {
  const route = resolveExtractionRoute(config);
  const candidates = route.prefersOpenRouter
    ? [
        openRouterSuggestClient(config, route.openrouterModel),
        ollamaSuggestClient(config, route.ollamaModel),
      ]
    : [
        ollamaSuggestClient(config, route.ollamaModel),
        openRouterSuggestClient(config, route.openrouterModel),
      ];
  return candidates.find((client) => client !== null) ?? null;
}

/** Generate the structured suggestion through one provider slot; failures degrade to null. */
async function generateSuggestion(
  registry: ProviderRegistry,
  provider: ProviderSlot,
  modelId: string,
  input: SuggestInput,
): Promise<VocabularySuggestion | null> {
  try {
    return await generateStructured({
      registry,
      provider,
      modelId,
      prompt: suggestPrompt(input),
      schema: vocabularySuggestionSchema,
      timeoutMs: SUGGEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof ProviderCallError) {
      return null;
    }
    throw error;
  }
}

function openRouterSuggestClient(
  config: AiConfig,
  modelId: string | null,
): SuggestClient | null {
  if (!config.openrouter.apiKey || modelId === null) {
    return null;
  }
  const registry: ProviderRegistry = {
    openrouter: createOpenAICompatible({
      name: 'openrouter',
      apiKey: config.openrouter.apiKey,
      baseURL: config.openrouter.baseUrl,
    }),
    local: null,
  };
  return {
    suggest: (input) => generateSuggestion(registry, 'openrouter', modelId, input),
  };
}

function ollamaSuggestClient(config: AiConfig, modelId: string | null): SuggestClient | null {
  if (modelId === null) {
    return null;
  }
  const registry: ProviderRegistry = {
    openrouter: null,
    // The provider speaks Ollama's native API under `/api` (`/api/chat`, …).
    local: createOllama({ baseURL: `${config.ollama.url.replace(/\/$/, '')}/api` }),
  };
  return {
    suggest: (input) => generateSuggestion(registry, 'ollama', modelId, input),
  };
}
