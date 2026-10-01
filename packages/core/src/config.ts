/**
 * Configuration the domain/application layer actually consumes. This is a
 * deliberate subset of the server's env-derived config: transport concerns
 * (port/host), storage paths, and the Qdrant serving sidecar are constructed at
 * the app edge and never reach the services. Keeping the port narrow is what
 * makes `@al-yo-bo/core` reusable and testable without an HTTP server.
 */
export interface CoreConfig {
  /** Probability at/above which the classifier may auto-assign an active tag. */
  autoAssignThreshold: number;
  /** Dataset new bookmarks/imports land in when none is specified. */
  defaultDataset: string;
  /** Query-embedding identity; semantic search is off without a model. */
  embeddings: {
    model?: string;
  };
  /** Ollaya decision daemon + the model used for classification questions. */
  ollaya: {
    baseUrl: string;
    apiKey?: string;
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
