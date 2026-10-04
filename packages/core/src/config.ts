/**
 * Configuration the domain/application layer actually consumes. This is a
 * deliberate subset of the server's env-derived config: transport concerns
 * (port/host), storage paths, and the Qdrant serving sidecar are constructed at
 * the app edge and never reach the services. Keeping the port narrow is what
 * makes `@al-yo-bo/core` reusable and testable without an HTTP server.
 *
 * The dataset axis is gone (MODEL.md principle 1 — one workspace), so there is
 * no scoping resolution here or anywhere else in core. `autoAssignThreshold`
 * mirrors the AI layer's `AUTO_ASSIGN_THRESHOLD`: one env source, two typed
 * views — the server threads the same value into both.
 */
export interface CoreConfig {
  /** Probability at/above which the classifier may auto-assign an active tag (§7 stage 4). */
  autoAssignThreshold: number;
  /**
   * Query-embedding identity; semantic search is off without a model. Also the
   * id stored in `bookmark_embeddings.model` — the configured model, never the
   * provider echo (§6/§8, M4).
   */
  embeddings: {
    model?: string;
  };
  /** Ollaya decision-model alias used for classification questions (§7 stage 3). */
  ollaya: {
    model: string;
  };
  /** Page enrichment options; see scrape.ts. */
  scrape: {
    timeoutMs: number;
    maxContentChars: number;
    /** html-to-markdown CLI binary (PATH-resolved; absolute paths allowed). */
    binary: string;
    /** Dead-link invalidation cap; shared with the job retry loop. */
    maxAttempts: number;
    /** HTML→markdown conversion subprocess timeout; defaults to 15000ms in scrape.ts. */
    conversionTimeoutMs?: number;
  };
}
