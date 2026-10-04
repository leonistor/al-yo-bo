/**
 * Concrete embedding adapter over the AI SDK (ARCHITECTURE §8): `embedMany`
 * through the OpenRouter provider from the central registry, replacing the
 * hand-rolled HTTP client of the former `packages/embeddings`. Constructed
 * only by `buildAiLayer` (consumed by apps/server, §4).
 */

import { APICallError, embedMany } from 'ai';

import type { EmbeddingClient, EmbeddingResult } from '../embedding.ts';
import type { ProviderRegistry } from '../registry.ts';

export interface EmbeddingAdapterConfig {
  /**
   * The configured `EMBEDDING_MODEL` id. Fixes the vector dimensions and is
   * the only id this adapter ever reports (M4 model rule, §6/§8).
   */
  model: string;
  /** Per-request timeout; a hung provider must degrade, not hang the worker. */
  timeoutMs?: number;
}

/** Default request timeout (ms) when `timeoutMs` is not configured. */
const DEFAULT_TIMEOUT_MS = 30_000;

export class AiEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly config: EmbeddingAdapterConfig,
  ) {}

  async embed(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { vectors: [], dims: 0, model: this.config.model };
    }
    const provider = this.registry.openrouter;
    if (!provider) {
      throw new Error(
        'OpenRouter embeddings failed: no provider configured (OPENROUTER_API_KEY unset)',
      );
    }

    let embeddings: number[][];
    try {
      // Retries stay at the job-loop layer (§10) — fail fast here so callers
      // degrade to keyword-only search instead of hanging a worker slot.
      const result = await embedMany({
        model: provider.embeddingModel(this.config.model),
        values: texts,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      embeddings = result.embeddings;
    } catch (error) {
      // Keep the package error convention (ported from packages/embeddings) so
      // callers degrade on the same messages as before.
      throw new Error(`OpenRouter embeddings failed: ${describeFailure(error)}`, { cause: error });
    }

    const vectors = embeddings.map((embedding) => Float32Array.from(embedding));
    const dims = vectors[0]?.length ?? 0;
    if (vectors.some((vector) => vector.length !== dims)) {
      throw new Error('OpenRouter embeddings returned inconsistent dimensions');
    }
    // M4 model rule (§6/§8): report the CONFIGURED id, never the provider's
    // response echo — the AI SDK result carries no usable model field anyway,
    // and OpenRouter normalizes ids in its response body.
    return { vectors, dims, model: this.config.model };
  }
}

/** Message for a failed embed call; timeout aborts surface as timeouts. */
function describeFailure(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'request timed out';
  }
  if (APICallError.isInstance(error)) {
    return error.statusCode != null ? `${error.statusCode} ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
