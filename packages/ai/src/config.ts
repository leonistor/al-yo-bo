/**
 * The single typed AI config (ARCHITECTURE §8). One zod schema over the env,
 * parsed once by the app edge and threaded through `buildAiLayer` — the old
 * per-package config objects (`packages/embeddings`, `packages/classifier`,
 * `apps/server` env plumbing) consolidate here.
 *
 * Absent optional variables never throw: they fall back to the §8 defaults or
 * stay `undefined` so the affected capability degrades (§1.5). Present-but-
 * invalid values (a non-numeric threshold, say) fail fast — that is a config
 * error, not a degradation.
 */

import { z } from 'zod';

/** The §8 config table, verbatim. */
const defaults = {
  ollayaUrl: 'http://127.0.0.1:11435',
  ollayaModel: 'laya',
  ollamaUrl: 'http://127.0.0.1:11434',
  autoAssignThreshold: 0.7,
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  embeddingModel: 'openai/text-embedding-3-small',
} as const;

/**
 * An empty/whitespace env value means "unset", not `0`/`""` — without this a
 * bare `AUTO_ASSIGN_THRESHOLD=` in .env would silently coerce to 0 and
 * auto-assign every tag below 1.0.
 */
function blankToUndefined(value: unknown): unknown {
  if (value == null || String(value).trim() === '') return undefined;
  return value;
}

const aiConfigSchema = z.object({
  /** Ollaya decision daemon (classifier sidecar, ARCHITECTURE §3/§7). */
  ollaya: z.object({
    url: z.string().default(defaults.ollayaUrl),
    apiKey: z.string().optional(),
    /** Decision model *alias*; the daemon resolves it to a checkpoint per call. */
    model: z.preprocess(blankToUndefined, z.string().default(defaults.ollayaModel)),
  }),
  /** Local Ollama daemon (chat, embeddings and local extraction fallback, ARCHITECTURE §3). */
  ollama: z.object({
    url: z.string().default(defaults.ollamaUrl),
    /** Unset disables chat (503) and removes the Ollama extraction fallback. */
    chatModel: z.preprocess(blankToUndefined, z.string().optional()),
    /**
     * Local embedding model (dev embeddings, §6/§8): when set outside
     * production, embeddings are served by this model on the Ollama daemon
     * instead of degrading to keyword-only search. Unset keeps dev
     * keyword-only; production embeddings always take the OpenRouter route.
     */
    embedModel: z.preprocess(blankToUndefined, z.string().optional()),
  }),
  openrouter: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().default(defaults.openrouterBaseUrl),
    /** Fixes the vector dimensions; a change requires a re-embed pass (§6). */
    embeddingModel: z.preprocess(blankToUndefined, z.string().default(defaults.embeddingModel)),
  }),
  /** Minimum probability to auto-assign a classifier tag (§7 stage 4). */
  autoAssignThreshold: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0).max(1).default(defaults.autoAssignThreshold),
  ),
  /**
   * Import-extraction model (§7 stage 1). A `/`-containing id selects
   * OpenRouter; any other id selects the local Ollama path; unset falls back
   * per the §8 table (see `resolveExtractionRoute`).
   */
  extractModel: z.preprocess(blankToUndefined, z.string().optional()),
  /** Optional bearer token for the bookmarks MCP server (loopback, §8). */
  mcpToken: z.preprocess(blankToUndefined, z.string().optional()),
  /**
   * Dev/prod switch (`NODE_ENV=production`, set by `bun run start`). OpenRouter
   * is a production provider (§8): its defaults — the embedding client and the
   * default extraction model — engage only here; development degrades to the
   * local Ollama path and keyword-only search instead of spending the cloud
   * key. An explicit `EXTRACT_MODEL` overrides the default in either
   * environment.
   */
  production: z.boolean().default(false),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;

/**
 * Parse the AI config from an env map (default `process.env`). Never throws
 * for absent optionals; throws a zod error for present-but-invalid values.
 */
export function parseAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  return aiConfigSchema.parse({
    ollaya: {
      url: env.OLLAYA_URL,
      apiKey: env.OLLAYA_API_KEY,
      model: env.OLLAYA_MODEL,
    },
    ollama: {
      url: env.OLLAMA_URL,
      chatModel: env.OLLAMA_CHAT_MODEL,
      embedModel: env.OLLAMA_EMBED_MODEL,
    },
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL,
      embeddingModel: env.EMBEDDING_MODEL,
    },
    autoAssignThreshold: env.AUTO_ASSIGN_THRESHOLD,
    extractModel: env.EXTRACT_MODEL,
    mcpToken: env.MCP_TOKEN,
    production: env.NODE_ENV === 'production' ? true : undefined,
  });
}
