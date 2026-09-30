/**
 * Thin boundary around the OpenRouter embeddings API (OpenAI-compatible
 * `POST /v1/embeddings`). Mirrors `packages/classifier`: one interface, one
 * adapter, no framework imports — swap or mock without touching callers.
 *
 * OpenRouter is optional at every call site: query embedding failures degrade
 * to keyword-only search (ARCHITECTURE §6), never block a request.
 */

export interface EmbeddingResult {
  vectors: Float32Array[];
  dims: number;
  model: string;
}

export interface EmbeddingClient {
  embed(texts: string[]): Promise<EmbeddingResult>;
}

export interface OpenRouterEmbeddingsConfig {
  apiKey: string;
  /** Model id, e.g. `openai/text-embedding-3-small`. Fixes the vector dimensions. */
  model: string;
  baseUrl?: string;
}

interface OpenAiEmbeddingsBody {
  data?: Array<{ index?: number; embedding?: number[] }>;
  model?: string;
  error?: { message?: string; code?: number | string };
}

export class OpenRouterEmbeddings implements EmbeddingClient {
  constructor(private readonly config: OpenRouterEmbeddingsConfig) {}

  async embed(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { vectors: [], dims: 0, model: this.config.model };
    }

    const response = await fetch(`${this.baseUrl()}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.model, input: texts }),
    });

    const body = (await response.json().catch(() => null)) as OpenAiEmbeddingsBody | null;
    if (!response.ok) {
      const message = body?.error?.message ?? response.statusText;
      throw new Error(`OpenRouter embeddings failed: ${response.status} ${message}`);
    }
    if (body?.error?.message) {
      throw new Error(`OpenRouter embeddings failed: ${body.error.message}`);
    }

    // The API returns rows in request order, but sort by `index` defensively.
    const rows = [...(body?.data ?? [])].toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== texts.length) {
      throw new Error(`OpenRouter embeddings returned ${rows.length} vectors for ${texts.length} inputs`);
    }

    const vectors = rows.map((row) => {
      if (!Array.isArray(row.embedding)) {
        throw new Error('OpenRouter embeddings response is missing a vector');
      }
      return Float32Array.from(row.embedding);
    });
    const dims = vectors[0]?.length ?? 0;
    if (vectors.some((vector) => vector.length !== dims)) {
      throw new Error('OpenRouter embeddings returned inconsistent dimensions');
    }
    return { vectors, dims, model: body?.model ?? this.config.model };
  }

  private baseUrl(): string {
    return (this.config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  }
}
