import { join } from 'node:path';

import { resolveDataDir } from '@al-yo-bo/db';
import type { CoreConfig } from '@al-yo-bo/core';

/**
 * Server-only configuration layered on top of the core config the service layer
 * consumes. `autoAssignThreshold`, `ollaya`, and `scrape` are inherited from
 * `CoreConfig`; `embeddings` widens the core shape with the adapter credentials
 * (OpenRouter), and `qdrant`/`chat`/`extract`/`screenshot`/the data-root paths
 * are transport/serving concerns that never reach core.
 */
export interface ServerConfig extends CoreConfig {
  port: number;
  host: string;
  /** Resolved data root (env `DATA_DIR`; ARCHITECTURE §5). */
  dataDir: string;
  dbPath: string;
  /** Screenshot artifact directory, served under `/data/screenshots/`. */
  screenshotsDir: string;
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
  /** Chat (AI SDK + local Ollama); off without a model. */
  chat: {
    ollamaUrl: string;
    model?: string;
  };
  /** Screenshot enrichment (ARCHITECTURE §8). */
  screenshot: {
    width: number;
    height: number;
    settleMs: number;
    timeoutMs: number;
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  // Single data root (ARCHITECTURE §5): every file artifact — SQLite,
  // screenshots, avatars, Qdrant storage — lives under one directory, so one
  // env knob relocates the whole tree. resolveDataDir (packages/db) anchors
  // relative values to the repo root so `bun run dev` and the CLI scripts
  // agree regardless of cwd.
  const dataDir = resolveDataDir(env.DATA_DIR);
  return {
    port: numberFromEnv(env.PORT, 3000),
    host: env.HOST ?? '127.0.0.1',
    dataDir,
    dbPath: env.DB_PATH ?? join(dataDir, 'bookmarks.db'),
    screenshotsDir: env.SCREENSHOTS_DIR ?? join(dataDir, 'screenshots'),
    autoAssignThreshold: numberFromEnv(env.AUTO_ASSIGN_THRESHOLD, 0.7),
    defaultDataset: env.DEFAULT_DATASET ?? 'default',
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
      maxAttempts: numberFromEnv(env.SCRAPE_MAX_ATTEMPTS, 3),
    },
    chat: {
      ollamaUrl: env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
      // Chat is off until a model is chosen (degrades to a 503, never an error).
      model: env.OLLAMA_CHAT_MODEL || undefined,
    },
    screenshot: {
      width: numberFromEnv(env.SCREENSHOT_WIDTH, 1280),
      height: numberFromEnv(env.SCREENSHOT_HEIGHT, 800),
      settleMs: numberFromEnv(env.SCREENSHOT_SETTLE_MS, 1_500),
      timeoutMs: numberFromEnv(env.SCREENSHOT_TIMEOUT_MS, 15_000),
    },
  };
}
