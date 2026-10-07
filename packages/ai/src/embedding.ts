/**
 * Embedding boundary (ARCHITECTURE §8). `core` consumes only this interface —
 * the concrete AI SDK adapters live in `adapters/embedding.ts` so importing
 * these types never pulls provider runtime code (§4 interface/adapter split).
 *
 * Embeddings are optional at every call site: query embedding failures degrade
 * to keyword-only search (ARCHITECTURE §6), never block a request. The active
 * provider is config-derived (`resolveEmbeddingRoute`): OpenRouter in
 * production with a key, the local Ollama daemon in development when
 * `OLLAMA_EMBED_MODEL` is set, else none.
 */

import type { AiConfig } from './config.ts';

export interface EmbeddingResult {
  vectors: Float32Array[];
  dims: number;
  /**
   * The CONFIGURED `EMBEDDING_MODEL` id — never the provider's response echo.
   * `bookmark_embeddings.model` stores this value (ARCHITECTURE §6/§8, M4):
   * OpenRouter normalizes model ids (e.g. `text-embedding-3-small` for
   * `openai/text-embedding-3-small`), and storing the echo would flag every
   * row as stale on every startup, re-embedding the library forever.
   */
  model: string;
}

export interface EmbeddingClient {
  /** Embed a batch of texts in request order; vectors align with the input. */
  embed(texts: string[]): Promise<EmbeddingResult>;
}

/** Which provider serves embeddings for the current config (§8). */
export type EmbeddingProvider = 'openrouter' | 'ollama';

export interface EmbeddingRoute {
  provider: EmbeddingProvider;
  /**
   * The model id that names the embedding capability everywhere it is stored
   * or reported: the configured `EMBEDDING_MODEL` (OpenRouter) or the
   * `OLLAMA_EMBED_MODEL` id (Ollama) — never a provider response echo (§6).
   */
  model: string;
}

/**
 * The embedding routing decision, derived purely from config (no I/O) —
 * shared by adapter construction (`buildAiLayer`) and the health report,
 * mirroring `resolveExtractionRoute` (§8):
 *
 * 1. production (`NODE_ENV=production`) with `OPENROUTER_API_KEY` → OpenRouter
 *    (`EMBEDDING_MODEL`, default `openai/text-embedding-3-small`);
 * 2. otherwise `OLLAMA_EMBED_MODEL` → the local Ollama daemon — the dev path
 *    for semantic search, so development can exercise embeddings without
 *    spending the cloud key;
 * 3. otherwise no embedding capability (keyword-only search, §6).
 *
 * OpenRouter embeddings stay production-only (§8 "decided"): an explicit
 * `EMBEDDING_MODEL` does not engage OpenRouter in development.
 */
export function resolveEmbeddingRoute(config: AiConfig): EmbeddingRoute | null {
  if (config.production && config.openrouter.apiKey !== undefined) {
    return { provider: 'openrouter', model: config.openrouter.embeddingModel };
  }
  if (config.ollama.embedModel !== undefined) {
    return { provider: 'ollama', model: config.ollama.embedModel };
  }
  return null;
}
