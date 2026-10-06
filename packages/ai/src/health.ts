/**
 * Capability probes → degrade flags (ARCHITECTURE §8), adapted from the legacy
 * `core` health service probe. Health is descriptive, never a liveness gate
 * (§1.5): every flag here only decides what the UI/API reports as degraded —
 * keyword-only search, manual tagging, 503 chat.
 */

import type { AiConfig } from './config.ts';
import { resolveExtractionRoute } from './extract.ts';

export interface AiHealthReport {
  /** Ollaya daemon answers (4xx still proves it is up — only transport failure counts). */
  ollayaReachable: boolean;
  /** Ollama daemon answers (chat/extraction fallback sidecar). */
  ollamaReachable: boolean;
  /** Chat capability: `OLLAMA_CHAT_MODEL` is set (an unreachable daemon surfaces an in-stream error instead, §12). */
  chatAvailable: boolean;
  chatModel: string | null;
  /** Embedding capability: production (`NODE_ENV=production`) with `OPENROUTER_API_KEY` set — otherwise search degrades to keyword-only (§6/§8). */
  embeddingsConfigured: boolean;
  /** The configured `EMBEDDING_MODEL` — the id stored in `bookmark_embeddings.model` (§6/§8, M4). */
  embeddingModel: string;
  /** The Ollaya decision-model alias (the resolved checkpoint is persisted per run, §7). */
  classifierModel: string;
  /** LLM extraction provider resolved (else the deterministic parser serves imports, §7). */
  extractConfigured: boolean;
  extractModel: string | null;
}

export interface AiHealth {
  report(): Promise<AiHealthReport>;
}

/** Cached probe TTL and timeout — ported from the legacy health probe. */
const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 750;

/**
 * Build the health probes from the central config. Probes are per-instance
 * state: a server may run several layers (e.g. tests) without the TTL caches
 * clobbering each other.
 */
export function createAiHealth(config: AiConfig): AiHealth {
  const probes = new Map<string, { at: number; reachable: boolean }>();

  async function probe(baseUrl: string): Promise<boolean> {
    const cached = probes.get(baseUrl);
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) {
      return cached.reachable;
    }
    let reachable = false;
    try {
      // Any HTTP response proves the daemon is up and answering — a 401 from
      // a key-protected Ollaya still means "reachable" (legacy probe intent).
      await fetch(baseUrl.replace(/\/$/, '') + '/', {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      reachable = true;
    } catch {
      reachable = false;
    }
    probes.set(baseUrl, { at: Date.now(), reachable });
    return reachable;
  }

  return {
    async report(): Promise<AiHealthReport> {
      const route = resolveExtractionRoute(config);
      const [ollayaReachable, ollamaReachable] = await Promise.all([
        probe(config.ollaya.url),
        probe(config.ollama.url),
      ]);
      return {
        ollayaReachable,
        ollamaReachable,
        chatAvailable: config.ollama.chatModel !== undefined,
        chatModel: config.ollama.chatModel ?? null,
        embeddingsConfigured: config.production && config.openrouter.apiKey !== undefined,
        embeddingModel: config.openrouter.embeddingModel,
        classifierModel: config.ollaya.model,
        extractConfigured: route.openrouterModel !== null || route.ollamaModel !== null,
        extractModel: route.prefersOpenRouter ? route.openrouterModel : route.ollamaModel,
      };
    },
  };
}
