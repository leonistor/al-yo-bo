/**
 * Embedding boundary (ARCHITECTURE §8). `core` consumes only this interface —
 * the concrete AI SDK adapter lives in `adapters/embedding.ts` so importing
 * these types never pulls provider runtime code (§4 interface/adapter split).
 *
 * OpenRouter is optional at every call site: query embedding failures degrade
 * to keyword-only search (ARCHITECTURE §6), never block a request.
 */

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
