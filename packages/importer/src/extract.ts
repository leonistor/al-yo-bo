import type { ImportedBookmark } from '@al-yo-bo/shared';

import { parseCollection } from './parse.ts';

export interface ExtractionResult {
  bookmarks: ImportedBookmark[];
  /** Provider that produced the extraction (LLM or deterministic fallback). */
  provider: 'llm' | 'fallback';
  /** Soft warnings — non-fatal issues to surface in the UI. */
  warnings?: string[];
}

/**
 * Prompt template for the LLM extraction path. The markdown collection format
 * is shown as a *suggestion* — the model is free to invent its own structure
 * when the input does not match — but the hard constraints (real URLs only, no
 * invented categories/tags) apply to every input.
 */
export function extractionPrompt(text: string): string {
  return [
    'Extract bookmarks from the user\'s free-form text.',
    '',
    'Output must be JSON matching the schema `{ bookmarks: Array<{ url, title, description, category, tags, priority }> }`.',
    'The `tags` array contains short, plain-word names. `category` is a single most-specific name per bookmark.',
    '`title` and `description` may be null when not stated. `priority` is null or 1–3 (personal importance).',
    '',
    'Hard rules:',
    '- Only extract URLs that actually appear in the input. Never invent URLs.',
    '- Only extract tags and categories that appear in the input or that you can derive plainly from the surrounding context.',
    '- If the input is empty, output `{ "bookmarks": [] }`.',
    '',
    'Suggested shape (the markdown collection-file convention; treat as a hint, not a contract):',
    '- A `## Heading` line introduces a category.',
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

/**
 * Deterministic fallback used when no LLM client is configured or the LLM
 * call fails. Wraps `parseCollection` so the offline path keeps working.
 */
export function fallbackExtraction(text: string): ImportedBookmark[] {
  return parseCollection(text).bookmarks;
}

/**
 * The transport-neutral extraction port. The app edge injects an implementation
 * (OpenRouter via `@ai-sdk/openai-compatible`, Ollama via `ollama-ai-provider-v2`,
 * or `null` to fall back to the deterministic parser).
 */
export interface ExtractionClient {
  extract(text: string): Promise<ImportedBookmark[]>;
}
