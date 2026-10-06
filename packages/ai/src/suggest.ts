/**
 * Vocabulary-suggestion boundary (ARCHITECTURE §7 stage 0). `core` consumes
 * only the `SuggestClient` interface; the LLM adapter (AI SDK `generateText` +
 * `Output.object`, OpenRouter primary / Ollama local) lives in
 * `adapters/suggest.ts` (§4 interface/adapter split).
 *
 * Suggestions derive from the developer-profile questionnaire and are deduped
 * against existing vocabulary. The wizard in `apps/web` lets the user confirm
 * which suggestions become real vocabulary; this module never persists.
 */

import { z } from 'zod';

/**
 * Developer-profile questionnaire content. A matching structural type lives in
 * `packages/shared` (db lane); `packages/ai` defines its own copy so the AI
 * layer does not depend on shared's rollout order (ARCHITECTURE §4).
 */
export interface DevProfile {
  source: string;
  focus?: string;
  languages?: string[];
  frameworks?: string[];
  tools?: string[];
  experience?: string;
  notes?: string;
}

export interface SuggestInput {
  devProfile: DevProfile;
  existing: {
    tags: string[];
    categoryPaths: string[][];
  };
}

export interface VocabularySuggestion {
  tags: { name: string; description?: string }[];
  categories: { path: string[]; description?: string }[];
}

/**
 * The transport-neutral suggestion port. The app edge injects an
 * implementation; `null` means no LLM provider is configured and the wizard
 * falls back to manual vocabulary creation (§1.5).
 */
export interface SuggestClient {
  suggest(input: SuggestInput): Promise<VocabularySuggestion | null>;
}

export const suggestedTagSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

export const suggestedCategorySchema = z.object({
  path: z.array(z.string()),
  description: z.string().optional(),
});

export const vocabularySuggestionSchema = z.object({
  tags: z.array(suggestedTagSchema),
  categories: z.array(suggestedCategorySchema),
});

/**
 * Prompt template for the LLM vocabulary-suggestion path. The model must derive
 * all names from the questionnaire only and dedupe against the existing
 * vocabulary supplied by the caller.
 */
export function suggestPrompt(input: SuggestInput): string {
  return [
    'Suggest a personal vocabulary for a single-user developer bookmark library.',
    '',
    'Output must be JSON matching the schema `{ tags: Array<{ name, description? }>, categories: Array<{ path, description? }> }`.',
    '',
    'The user has answered a developer-profile questionnaire. Derive tag names and category paths ONLY from that content.',
    'Tags are short, lowercase-ish, plain-word names (e.g. `react`, `python`, `performance`).',
    'Categories are hierarchical paths from root to leaf (e.g. `["dev", "web", "frontend"]`).',
    '',
    'Rules:',
    '- Only suggest vocabulary that can be plainly derived from the questionnaire.',
    '- Dedupe against the existing tags and category paths listed below; do not repeat them.',
    '- Keep suggestions small and high-signal: roughly 10-40 tags and 5-15 category paths.',
    '- Descriptions are optional; include only when they add clarity.',
    '',
    'Existing tags:',
    JSON.stringify(input.existing.tags),
    '',
    'Existing category paths:',
    JSON.stringify(input.existing.categoryPaths),
    '',
    'Developer profile:',
    JSON.stringify(input.devProfile),
  ].join('\n');
}
