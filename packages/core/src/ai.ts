import type { AiHealth, ClassifierClient, EmbeddingClient, ExtractionClient } from '@al-yo-bo/ai';

/**
 * The AI capabilities core consumes, as one structural port (ARCHITECTURE §4
 * interface/adapter split). The app edge passes its built `AiLayer` from
 * `buildAiLayer(config)` directly — it satisfies this shape — while tests pass
 * fakes. Only interface *types* are imported from `@al-yo-bo/ai`; the concrete
 * adapters and the single construction point stay out of core's graph.
 *
 * Every member degrades independently (§1.5): `embeddings: null` → keyword-only
 * search and skipped embed jobs; `classifier: null` → manual tagging;
 * `extract: null` → the deterministic markdown parser in the import service.
 */
export interface CoreAi {
  /** OpenRouter embeddings; `null` when `OPENROUTER_API_KEY` is unset (§8). */
  readonly embeddings: EmbeddingClient | null;
  /** Ollaya decision client; `null` disables classification entirely (§1.5). */
  readonly classifier: ClassifierClient | null;
  /** LLM extraction client; `null` → deterministic parser fallback (§7 stage 1). */
  readonly extract: ExtractionClient | null;
  /** Capability probes feeding the health report (§8). */
  readonly health: AiHealth;
}
