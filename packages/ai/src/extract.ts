/**
 * Import-extraction boundary (ARCHITECTURE §7 stage 1, ported from
 * `packages/importer/src/extract.ts`). `core` consumes only the
 * `ExtractionClient` interface; the LLM adapter (AI SDK `generateText` +
 * `Output.object`, OpenRouter primary / Ollama local) lives in
 * `adapters/extract.ts` (§4 interface/adapter split).
 *
 * The deterministic markdown fallback (`parseCollection`) stays in
 * `packages/importer`: the import service falls back to it when no LLM client
 * is configured or the LLM call fails — this module never parses markdown.
 */

import type { ImportedBookmark } from '@al-yo-bo/shared';
import { z } from 'zod';

import type { AiConfig } from './config.ts';

/** Which LLM provider produced an extraction. */
export type ExtractionProvider = 'openrouter' | 'ollama';

export interface ExtractionResult {
  bookmarks: ImportedBookmark[];
  /** Provider metadata — the import API surfaces this as `provider: 'llm'`. */
  provider: ExtractionProvider;
  /** The model id that answered (the `EXTRACT_MODEL` resolution). */
  model: string;
  /** Soft warnings — non-fatal issues to surface in the UI. */
  warnings: string[];
}

/**
 * The transport-neutral extraction port. The app edge injects an
 * implementation (OpenRouter via `@ai-sdk/openai-compatible`, Ollama via
 * `ollama-ai-provider-v2`, or `null` to fall back to the deterministic
 * markdown parser in `packages/importer`).
 */
export interface ExtractionClient {
  extract(text: string): Promise<ExtractionResult>;
}

/** Per-bookmark LLM output shape; mirrors the shared `ImportedBookmark`. */
export const extractedBookmarkSchema = z.object({
  url: z.string().url(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  /** Ancestor chain from the root (markdown H2 → level-1, H3 → child). */
  categoryPath: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  priority: z.number().int().min(1).max(3).nullish(),
});

export const extractionSchema = z.object({
  bookmarks: z.array(extractedBookmarkSchema),
});

/**
 * Prompt template for the LLM extraction path. The markdown collection format
 * is shown as a *suggestion* — the model is free to invent its own structure
 * when the input does not match — but the hard constraints (real URLs only, no
 * invented categories/tags) apply to every input.
 */
export function extractionPrompt(text: string): string {
  return [
    "Extract bookmarks from the user's free-form text.",
    '',
    'Output must be JSON matching the schema `{ bookmarks: Array<{ url, title, description, categoryPath, tags, priority }> }`.',
    'The `tags` array contains short, plain-word names. `categoryPath` is the ancestor chain of category',
    'names from the root to the most specific category, e.g. `["dev", "web"]`.',
    '`title` and `description` may be null when not stated. `priority` is null or 1–3 (personal importance).',
    '',
    'Hard rules:',
    '- Only extract URLs that actually appear in the input. Never invent URLs.',
    '- Only extract tags and categories that appear in the input or that you can derive plainly from the surrounding context.',
    '- If the input is empty, output `{ "bookmarks": [] }`.',
    '',
    'Suggested shape (the markdown collection-file convention; treat as a hint, not a contract):',
    '- A `## Heading` line introduces a level-1 category (the root of the path).',
    '- A `### Heading` line introduces a child of the current level-1 category.',
    '- A bullet item contains one or more URLs plus an optional note used as `title` and `description`.',
    '- A leading `*` / `**` / `***` on a bullet means priority 1 / 2 / 3.',
    '- A `---\\ntags: [a, b]\\n---` YAML frontmatter block attaches the listed tag names to every following bookmark.',
    '',
    'Input:',
    '"""',
    text,
    '"""',
  ].join('\n');
}

/** OpenRouter default when `EXTRACT_MODEL` is unset but a key is configured (§8 table). */
export const DEFAULT_OPENROUTER_EXTRACT_MODEL = 'deepseek/deepseek-v4.1-flash';

/**
 * The extraction routing decision, derived purely from config (no I/O) —
 * shared by the adapter construction and the health report. Ported from the
 * legacy server `resolveExtractModel`/`resolveExtractConfig` (§8 table):
 *
 * 1. `EXTRACT_MODEL` wins when set (an OpenRouter id is honored in any
 *    environment — explicit config beats the dev/prod default);
 * 2. otherwise the OpenRouter default when a key is configured AND the app
 *    runs in production (`NODE_ENV=production`): the cloud provider is never
 *    the dev default (§8), so development falls through to Ollama;
 * 3. otherwise `OLLAMA_CHAT_MODEL`;
 * 4. otherwise no LLM path (deterministic parser).
 *
 * A `/`-containing id is an OpenRouter model; any other id is an Ollama model.
 * When OpenRouter is preferred but its key is missing, the slot degrades to
 * null and the Ollama chat model (if any) remains as a secondary candidate.
 */
export interface ExtractionRoute {
  /** OpenRouter model id, or `null` when the slot is unusable (no key / not selected). */
  openrouterModel: string | null;
  /** Ollama model id (`EXTRACT_MODEL` local id or `OLLAMA_CHAT_MODEL`), or `null`. */
  ollamaModel: string | null;
  /** True when an OpenRouter id was selected — candidate order is OpenRouter first. */
  prefersOpenRouter: boolean;
}

export function resolveExtractionRoute(config: AiConfig): ExtractionRoute {
  const modelId =
    config.extractModel ??
    (config.production && config.openrouter.apiKey
      ? DEFAULT_OPENROUTER_EXTRACT_MODEL
      : undefined) ??
    config.ollama.chatModel ??
    null;
  const prefersOpenRouter = modelId !== null && modelId.includes('/');
  return {
    openrouterModel: prefersOpenRouter && config.openrouter.apiKey ? modelId : null,
    ollamaModel: prefersOpenRouter ? (config.ollama.chatModel ?? null) : modelId,
    prefersOpenRouter,
  };
}
