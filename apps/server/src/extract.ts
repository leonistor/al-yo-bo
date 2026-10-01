/**
 * LLM extraction adapter (ARCHITECTURE §2/§7 stage 1, post-simplification).
 *
 * The import page hits `POST /api/import/preview`; this module builds the
 * `ExtractionClient` that powers it. Two providers are supported:
 *
 *   - OpenRouter (default when `OPENROUTER_API_KEY` is set and `EXTRACT_MODEL`
 *     names an OpenRouter model). `@ai-sdk/openai-compatible` is used because
 *     OpenRouter exposes an OpenAI-compatible chat endpoint.
 *   - Ollama (`EXTRACT_MODEL` resolves to an Ollama chat model). The same
 *     `ollama-ai-provider-v2` client as the chat path uses.
 *
 * When no provider is configured (no API key, no Ollama URL, or `EXTRACT_MODEL`
 * unset) the import service falls back to `fallbackExtraction` from
 * `@al-yo-bo/importer` — the deterministic markdown parser.
 *
 * Extraction is synchronous at import time (one decide call per preview, not
 * per bookmark) and uses `generateText` + `Output.object({ schema })` to force
 * structured output.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { z } from 'zod';

import {
  extractionPrompt,
  type ExtractionClient,
} from '@al-yo-bo/importer';
import type { ImportedBookmark } from '@al-yo-bo/shared';

import type { ServerConfig } from './env.ts';

/** Per-bookmark schema (kept here, not in `@al-yo-bo/importer`, so zod stays server-side). */
const extractedBookmarkSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  priority: z.number().int().min(1).max(3).nullable(),
});

const extractionSchema = z.object({
  bookmarks: z.array(extractedBookmarkSchema),
});

export interface ExtractConfig {
  openrouter: { apiKey: string | null; model: string; baseUrl: string };
  ollama: { baseUrl: string; model: string | null };
}

export interface BuildExtractClientOptions {
  /** Override the default config resolution (used by tests). */
  extract?: ExtractConfig;
}

/**
 * Returns an ExtractionClient that uses OpenRouter via `@ai-sdk/openai-compatible`,
 * or `null` if no key/model is available. Failures are surfaced as thrown errors
 * so the caller can fall back to the deterministic parser.
 */
export function openRouterExtractionClient(config: ExtractConfig): ExtractionClient | null {
  if (!config.openrouter.apiKey || !config.openrouter.model) {
    return null;
  }
  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
  });

  return {
    async extract(text: string): Promise<ImportedBookmark[]> {
      const { output } = await generateText({
        model: provider(config.openrouter.model),
        prompt: extractionPrompt(text),
        output: Output.object({ schema: extractionSchema }),
      });
      return output.bookmarks.map(toImportedBookmark);
    },
  };
}

/**
 * Returns an ExtractionClient that uses the local Ollama daemon, or `null` if
 * no chat model is configured. Same fallback semantics as the OpenRouter path.
 */
export function ollamaExtractionClient(config: ExtractConfig): ExtractionClient | null {
  if (!config.ollama.model) {
    return null;
  }
  const provider = createOllama({
    baseURL: `${config.ollama.baseUrl.replace(/\/$/, '')}/api`,
  });

  return {
    async extract(text: string): Promise<ImportedBookmark[]> {
      const { output } = await generateText({
        model: provider(config.ollama.model as string),
        prompt: extractionPrompt(text),
        output: Output.object({ schema: extractionSchema }),
      });
      return output.bookmarks.map(toImportedBookmark);
    },
  };
}

/**
 * Resolves the ExtractionClient from server config. Preference order:
 * `EXTRACT_MODEL` env -> OpenRouter when an OpenRouter key is set, else Ollama.
 * Returns `null` when no provider is configured — the import service then uses
 * the deterministic parser.
 */
export function buildExtractionClient(
  config: ServerConfig,
): ExtractionClient | null {
  const modelId = resolveExtractModel(config);
  const extractConfig: ExtractConfig = {
    openrouter: {
      apiKey: config.embeddings.apiKey ?? null,
      model: modelId ?? '',
      baseUrl: config.embeddings.baseUrl ?? 'https://openrouter.ai/api/v1',
    },
    ollama: {
      baseUrl: config.chat.ollamaUrl,
      model: config.chat.model ?? null,
    },
  };

  // If EXTRACT_MODEL names an OpenRouter-style id (contains a provider slash),
  // prefer OpenRouter; otherwise prefer Ollama when the chat model is set.
  const prefersOpenRouter = modelId?.includes('/');
  const candidates = prefersOpenRouter
    ? [openRouterExtractionClient(extractConfig), ollamaExtractionClient(extractConfig)]
    : [ollamaExtractionClient(extractConfig), openRouterExtractionClient(extractConfig)];

  for (const client of candidates) {
    if (client) {
      return client;
    }
  }
  return null;
}

function resolveExtractModel(config: ServerConfig): string | null {
  const envModel = process.env['EXTRACT_MODEL'];
  if (envModel && envModel.length > 0) {
    return envModel;
  }
  if (config.embeddings.apiKey) {
    return 'deepseek/deepseek-v4.1-flash';
  }
  if (config.chat.model) {
    return config.chat.model;
  }
  return null;
}

/** Adapter from the LLM-extracted shape (zod-validated) to the shared `ImportedBookmark`. */
function toImportedBookmark(extracted: z.infer<typeof extractedBookmarkSchema>): ImportedBookmark {
  return {
    url: extracted.url,
    title: extracted.title ?? null,
    description: extracted.description ?? null,
    category: extracted.category ?? null,
    priority: extracted.priority ?? null,
    tags: extracted.tags,
  } satisfies ImportedBookmark;
}

/** Error class so the import service can log the failure and fall back cleanly. */
export class ExtractionFailedError extends Error {
  constructor(cause: unknown) {
    super(
      `LLM extraction failed: ${
        cause instanceof NoObjectGeneratedError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause)
      }`,
    );
    this.name = 'ExtractionFailedError';
  }
}
