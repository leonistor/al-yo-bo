/**
 * `@al-yo-bo/ai` — the single AI layer (ARCHITECTURE §8). All AI access
 * consolidates here: the former `packages/embeddings` (OpenRouter HTTP) and
 * `packages/classifier` (Ollaya client) plus the import-extraction client and
 * the wizard vocabulary-suggestion client.
 *
 * Interface/adapter split (§4): `packages/core` imports ONLY the interfaces
 * and types below (type-only imports — no runtime provider code is pulled).
 * The concrete adapters live in `adapters/` and are constructed exclusively
 * here by `buildAiLayer`, which only `apps/server` calls.
 */

import { AiEmbeddingClient } from './adapters/embedding.ts';
import { createExtractionClient } from './adapters/extract.ts';
import type { ClassifierClient } from './classifier.ts';
import { OllayaClassifierClient } from './classifier.ts';
import { createSuggestClient } from './adapters/suggest.ts';
import type { AiConfig } from './config.ts';
import type { EmbeddingClient } from './embedding.ts';
import type { ExtractionClient } from './extract.ts';
import type { AiHealth } from './health.ts';
import { createAiHealth } from './health.ts';
import type { ProviderRegistry } from './registry.ts';
import { createProviderRegistry } from './registry.ts';
import type { SuggestClient } from './suggest.ts';

/**
 * The built AI layer handed to core by the app edge. Every member degrades
 * independently (§1.5): `embeddings: null` → keyword-only search;
 * `extract: null` → deterministic parser; `suggest: null` → manual wizard
 * vocabulary; the classifier always constructs — an unreachable Ollaya daemon
 * only fails classification jobs.
 */
export interface AiLayer {
  readonly config: AiConfig;
  /** Explicit provider instances (no ambient defaults, §8). */
  readonly registry: ProviderRegistry;
  /** OpenRouter embeddings; `null` when `OPENROUTER_API_KEY` is unset. */
  readonly embeddings: EmbeddingClient | null;
  /** Ollaya decision client (bespoke — not an AI SDK provider, §3/§8). */
  readonly classifier: ClassifierClient;
  /** LLM extraction client; `null` → deterministic markdown fallback in core. */
  readonly extract: ExtractionClient | null;
  /** LLM vocabulary-suggestion client; `null` → wizard skips AI suggestions. */
  readonly suggest: SuggestClient | null;
  /** Capability probes → degrade flags for the health endpoint. */
  readonly health: AiHealth;
}

/**
 * The single construction point for the AI layer (§8): builds the provider
 * registry and every client from one parsed `AiConfig`. Called once by
 * `apps/server` during bootstrapping; core receives the resulting object.
 */
export function buildAiLayer(config: AiConfig): AiLayer {
  const registry = createProviderRegistry({
    openrouter: config.openrouter.apiKey
      ? { apiKey: config.openrouter.apiKey, baseUrl: config.openrouter.baseUrl }
      : undefined,
    // The Ollama provider speaks the native API under `/api` (`/api/chat`, …).
    local: { baseUrl: `${config.ollama.url.replace(/\/$/, '')}/api` },
  });

  return {
    config,
    registry,
    embeddings: config.openrouter.apiKey
      ? new AiEmbeddingClient(registry, { model: config.openrouter.embeddingModel })
      : null,
    classifier: new OllayaClassifierClient({
      baseUrl: config.ollaya.url,
      apiKey: config.ollaya.apiKey,
    }),
    extract: createExtractionClient(config),
    suggest: createSuggestClient(config),
    health: createAiHealth(config),
  };
}

// Config (runtime `parseAiConfig` is consumed by the app edge only).
export type { AiConfig } from './config.ts';
export { parseAiConfig } from './config.ts';

// Registry.
export type { ProviderRegistry, RegistryProviders } from './registry.ts';
export { createProviderRegistry } from './registry.ts';

// Interfaces core consumes (type-only; adapters stay out of core's graph).
export type { EmbeddingClient, EmbeddingResult } from './embedding.ts';
export type { ClassifierClient, DecideRequest, DecideResult, NoulQuestion } from './classifier.ts';
export type { ExtractionClient, ExtractionProvider, ExtractionResult } from './extract.ts';

// Classifier adapter — bespoke Ollaya client, constructed from central config.
export type { OllayaConfig } from './classifier.ts';
export { OllayaClassifierClient } from './classifier.ts';

// Extraction contract, prompt and routing (transport-neutral; no AI SDK).
export {
  DEFAULT_OPENROUTER_EXTRACT_MODEL,
  extractionPrompt,
  extractionSchema,
  extractedBookmarkSchema,
  resolveExtractionRoute,
} from './extract.ts';
export type { ExtractionRoute } from './extract.ts';

// Suggestion contract, prompt and schema (transport-neutral; no AI SDK).
export {
  suggestPrompt,
  suggestedCategorySchema,
  suggestedTagSchema,
  vocabularySuggestionSchema,
} from './suggest.ts';
export type {
  DevProfile,
  SuggestClient,
  SuggestInput,
  VocabularySuggestion,
} from './suggest.ts';

// Health.
export type { AiHealth, AiHealthReport } from './health.ts';
export { createAiHealth } from './health.ts';

// Adapter surface consumed only by apps/server.
export { AiEmbeddingClient } from './adapters/embedding.ts';
export type { EmbeddingAdapterConfig } from './adapters/embedding.ts';
export { createExtractionClient, ExtractionError } from './adapters/extract.ts';
export { createSuggestClient } from './adapters/suggest.ts';
