import { join } from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  autoAssignThreshold: number;
  ollaya: {
    baseUrl: string;
    apiKey?: string;
    model: string;
  };
  /** Vector-serving sidecar (ARCHITECTURE §6); disabled when `url` is undefined. */
  qdrant: {
    url?: string;
    collection: string;
    apiKey?: string;
    timeoutMs: number;
  };
  /** Query-embedding provider; semantic search is off without a key and model. */
  embeddings: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  /** Page enrichment; see apps/server/src/scrape.ts. */
  scrape: {
    timeoutMs: number;
    maxContentChars: number;
    /** html-to-markdown CLI binary (PATH-resolved; absolute paths allowed). */
    binary: string;
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Anchored to the repo root so `bun run dev` (which runs with the package as cwd)
// and `bun run db:seed` point at the same SQLite file.
const DEFAULT_DB_PATH = join(import.meta.dir, '../../../data/bookmarks.db');

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    port: numberFromEnv(env.PORT, 3000),
    host: env.HOST ?? '127.0.0.1',
    dbPath: env.DB_PATH ?? DEFAULT_DB_PATH,
    autoAssignThreshold: numberFromEnv(env.AUTO_ASSIGN_THRESHOLD, 0.5),
    ollaya: {
      baseUrl: env.OLLAYA_URL ?? 'http://127.0.0.1:11435',
      apiKey: env.OLLAYA_API_KEY,
      model: env.OLLAYA_MODEL ?? 'laya',
    },
    qdrant: {
      // On by default (matching the sidecar deployment); `QDRANT_URL=""` turns it off.
      url: env.QDRANT_URL === '' ? undefined : (env.QDRANT_URL ?? 'http://127.0.0.1:6333'),
      collection: env.QDRANT_COLLECTION ?? 'bookmarks',
      apiKey: env.QDRANT_API_KEY,
      timeoutMs: numberFromEnv(env.QDRANT_TIMEOUT_MS, 5_000),
    },
    embeddings: {
      apiKey: env.OPENROUTER_API_KEY,
      // Pinned default (docs/ARCHITECTURE §6/§7): 1536 dims, cheap, matches the
      // benchmarked fallback matrix. Changing the model triggers a re-embed pass.
      model: env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
      baseUrl: env.OPENROUTER_BASE_URL,
    },
    scrape: {
      timeoutMs: numberFromEnv(env.SCRAPE_TIMEOUT_MS, 15_000),
      maxContentChars: numberFromEnv(env.SCRAPE_MAX_CONTENT_CHARS, 200_000),
      binary: env.HTML_TO_MARKDOWN_BIN ?? 'html-to-markdown',
    },
  };
}
