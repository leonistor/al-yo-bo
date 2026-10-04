import { join } from 'node:path';

import { parseAiConfig, type AiConfig } from '@al-yo-bo/ai';
import type { CoreConfig } from '@al-yo-bo/core';
import { resolveDataDir } from '@al-yo-bo/db';

/**
 * Server-only configuration layered on top of the core config the service layer
 * consumes. The AI env (OLLAYA_*, OLLAMA_*, OPENROUTER_*, EXTRACT_MODEL,
 * threshold) is parsed ONCE by `packages/ai` (ARCHITECTURE §8) and threaded
 * through as `ai` — `buildAiLayer` consumes it and the CoreConfig view below is
 * derived from it, so there is a single source of truth per knob. The remaining
 * keys (port/host, data-root paths, Qdrant serving, screenshot knobs) are
 * transport concerns that never reach core.
 */
export interface ServerConfig extends CoreConfig {
  port: number;
  host: string;
  /** Resolved data root (env `DATA_DIR`; ARCHITECTURE §5). */
  dataDir: string;
  dbPath: string;
  /** Screenshot artifact directory, served under `/data/screenshots/`. */
  screenshotsDir: string;
  /** Parsed AI config — the pass-through that feeds `buildAiLayer` and chat. */
  ai: AiConfig;
  /**
   * Bookmarks MCP server (ARCHITECTURE §8). The token comes from `MCP_TOKEN`
   * (already parsed once by `packages/ai`); unset → loopback-only, no token.
   */
  mcp: { token?: string };
  /** Vector-serving sidecar (ARCHITECTURE §6); disabled when `url` is undefined. */
  qdrant: {
    url?: string;
    collection: string;
    apiKey?: string;
    timeoutMs: number;
  };
  /** Screenshot enrichment (ARCHITECTURE §10). */
  screenshot: {
    width: number;
    height: number;
    settleMs: number;
    timeoutMs: number;
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  // A blank env value (`PORT=`) means "unset", not 0 — Number('') is 0, which
  // would silently bind port 0 or turn a timeout into an instant abort.
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  // Single parse point for the AI env (§8): absent optionals degrade, invalid
  // values fail fast. `parseAiConfig` reads the OLLAYA_*/OLLAMA_*/OPENROUTER_*
  // pass-through, AUTO_ASSIGN_THRESHOLD, EXTRACT_MODEL and MCP_TOKEN.
  const ai = parseAiConfig(env);
  // Single data root (ARCHITECTURE §5): every file artifact — SQLite,
  // screenshots, avatars, Qdrant storage — lives under one directory, so one
  // env knob relocates the whole tree. resolveDataDir (packages/db) anchors
  // relative values to the repo root so `bun run dev` and the CLI scripts
  // agree regardless of cwd.
  const dataDir = resolveDataDir(env.DATA_DIR);
  return {
    ai,
    // MCP bearer token (§8): same parse point as the rest of the AI env.
    mcp: { token: ai.mcpToken },
    port: numberFromEnv(env.PORT, 3000),
    host: env.HOST ?? '127.0.0.1',
    dataDir,
    dbPath: env.DB_PATH ?? join(dataDir, 'bookmarks.db'),
    screenshotsDir: env.SCREENSHOTS_DIR ?? join(dataDir, 'screenshots'),
    // CoreConfig views derived from the AI config — same values, narrower type.
    autoAssignThreshold: ai.autoAssignThreshold,
    embeddings: {
      // Pinned default (docs/ARCHITECTURE §6): 1536 dims, cheap, matches the
      // benchmarked fallback matrix. Changing the model triggers a re-embed pass.
      model: ai.openrouter.embeddingModel,
    },
    ollaya: { model: ai.ollaya.model },
    scrape: {
      timeoutMs: numberFromEnv(env.SCRAPE_TIMEOUT_MS, 15_000),
      maxContentChars: numberFromEnv(env.SCRAPE_MAX_CONTENT_CHARS, 200_000),
      binary: env.HTML_TO_MARKDOWN_BIN ?? 'html-to-markdown',
      maxAttempts: numberFromEnv(env.SCRAPE_MAX_ATTEMPTS, 3),
      maxBytes: numberFromEnv(env.SCRAPE_MAX_BYTES, 5 * 1024 * 1024),
    },
    qdrant: {
      // On by default (matching the sidecar deployment); `QDRANT_URL=""` turns it off.
      url: env.QDRANT_URL === '' ? undefined : (env.QDRANT_URL ?? 'http://127.0.0.1:6333'),
      collection: env.QDRANT_COLLECTION ?? 'bookmarks',
      apiKey: env.QDRANT_API_KEY,
      timeoutMs: numberFromEnv(env.QDRANT_TIMEOUT_MS, 5_000),
    },
    screenshot: {
      width: numberFromEnv(env.SCREENSHOT_WIDTH, 1280),
      height: numberFromEnv(env.SCREENSHOT_HEIGHT, 800),
      settleMs: numberFromEnv(env.SCREENSHOT_SETTLE_MS, 1_500),
      timeoutMs: numberFromEnv(env.SCREENSHOT_TIMEOUT_MS, 15_000),
    },
  };
}
