/**
 * Concrete LLM extraction adapter (ARCHITECTURE §7 stage 1, ported from the
 * legacy server `extract.ts`): AI SDK v7 `generateText` + `Output.object`
 * against OpenRouter (`@ai-sdk/openai-compatible`) or the local Ollama daemon
 * (`ollama-ai-provider-v2`). Constructed only by `buildAiLayer` (§4).
 *
 * Failures throw so the import service can fall back to the deterministic
 * markdown parser in `packages/importer` — extraction enriches, it never gates
 * (§1.5). The fallback itself lives outside this package.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { NoObjectGeneratedError } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';

import type { AiConfig } from '../config.ts';
import type { ExtractionClient, ExtractionProvider, ExtractionResult } from '../extract.ts';
import { extractionPrompt, extractionSchema, resolveExtractionRoute } from '../extract.ts';
import type { ProviderRegistry } from '../registry.ts';
import { generateStructured, ProviderCallError } from './generate-structured.ts';

/** Per-request budget for the interactive import preview; failure → deterministic fallback. */
const EXTRACT_TIMEOUT_MS = 60_000;

/**
 * Build the extraction client from the central config, resolving the
 * `EXTRACT_MODEL` route (OpenRouter primary, Ollama local — §8 table).
 * Returns `null` when no provider is configured; the caller then uses the
 * deterministic parser.
 */
export function createExtractionClient(config: AiConfig): ExtractionClient | null {
  const route = resolveExtractionRoute(config);
  const candidates = route.prefersOpenRouter
    ? [
        openRouterExtractionClient(config, route.openrouterModel),
        ollamaExtractionClient(config, route.ollamaModel),
      ]
    : [
        ollamaExtractionClient(config, route.ollamaModel),
        openRouterExtractionClient(config, route.openrouterModel),
      ];
  return candidates.find((client) => client !== null) ?? null;
}

/** Generate the structured extraction through one provider slot. */
async function generateExtraction(
  registry: ProviderRegistry,
  provider: ExtractionProvider,
  modelId: string,
  text: string,
): Promise<ExtractionResult> {
  try {
    const output = await generateStructured({
      registry,
      provider,
      modelId,
      prompt: extractionPrompt(text),
      schema: extractionSchema,
      timeoutMs: EXTRACT_TIMEOUT_MS,
    });
    return {
      bookmarks: output.bookmarks.map(toImportedBookmark),
      provider,
      model: modelId,
      warnings: [],
    };
  } catch (error) {
    // Re-wrap the shared provider error so the import service can log the
    // failing provider and fall back to the deterministic parser cleanly.
    if (error instanceof ProviderCallError) {
      throw new ExtractionError(provider, modelId, error.cause);
    }
    throw error;
  }
}

/** LLM extraction failed — the deterministic fallback should take over. */
export class ExtractionError extends Error {
  constructor(
    readonly provider: ExtractionProvider,
    readonly model: string,
    cause: unknown,
  ) {
    super(
      `LLM extraction failed (${provider}, ${model}): ${
        cause instanceof NoObjectGeneratedError
          ? `${cause.message}`
          : cause instanceof Error
            ? cause.message
            : String(cause)
      }`,
      { cause },
    );
    this.name = 'ExtractionError';
  }
}

function openRouterExtractionClient(
  config: AiConfig,
  modelId: string | null,
): ExtractionClient | null {
  if (!config.openrouter.apiKey || modelId === null) {
    return null;
  }
  const registry: ProviderRegistry = {
    openrouter: createOpenAICompatible({
      name: 'openrouter',
      apiKey: config.openrouter.apiKey,
      baseURL: config.openrouter.baseUrl,
      // Structured outputs: send `json_schema` instead of unconstrained
      // `json_object` (the adapter warns and drops schema enforcement otherwise).
      supportsStructuredOutputs: true,
    }),
    local: null,
  };
  return {
    extract: (text: string) => generateExtraction(registry, 'openrouter', modelId, text),
  };
}

function ollamaExtractionClient(config: AiConfig, modelId: string | null): ExtractionClient | null {
  if (modelId === null) {
    return null;
  }
  const registry: ProviderRegistry = {
    openrouter: null,
    // The provider speaks Ollama's native API under `/api` (`/api/chat`, …).
    local: createOllama({ baseURL: `${config.ollama.url.replace(/\/$/, '')}/api` }),
  };
  return {
    extract: (text: string) => generateExtraction(registry, 'ollama', modelId, text),
  };
}

/** Adapter from the LLM-extracted shape (zod-validated) to the shared `ImportedBookmark`. */
function toImportedBookmark(extracted: {
  url: string;
  title?: string | null;
  description?: string | null;
  categoryPath?: string[] | null;
  tags?: string[] | null;
  priority?: number | null;
}) {
  return {
    url: extracted.url,
    title: extracted.title ?? null,
    description: extracted.description ?? null,
    categoryPath: extracted.categoryPath ?? [],
    priority: extracted.priority ?? null,
    tags: extracted.tags ?? [],
  };
}
