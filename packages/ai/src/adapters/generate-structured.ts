/**
 * Shared LLM structured-generation plumbing for the AI SDK adapters.
 * Extracted from `adapters/extract.ts` so `adapters/suggest.ts` can reuse the
 * same call shape, timeout, and retry discipline (§4 interface/adapter split,
 * §1.5 graceful degradation).
 */

import { generateText, Output } from 'ai';
import type { z } from 'zod';

import type { ProviderRegistry } from '../registry.ts';

/** Provider slots that support chat-based structured output. */
export type ProviderSlot = 'openrouter' | 'ollama';

/**
 * A failed provider call during structured generation. Adapters decide how to
 * surface this: extraction rethrows a typed feature error; suggestion degrades
 * to `null`.
 */
export class ProviderCallError extends Error {
  constructor(
    readonly provider: ProviderSlot,
    readonly model: string,
    cause: unknown,
  ) {
    super(`Provider call failed (${provider}, ${model}): ${formatCause(cause)}`, {
      cause,
    });
    this.name = 'ProviderCallError';
  }
}

export interface GenerateStructuredOptions<T> {
  registry: ProviderRegistry;
  provider: ProviderSlot;
  modelId: string;
  prompt: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
}

/**
 * Generate a typed object through one provider slot. Retries stay off: the
 * callers either have an instant fallback (extraction) or are interactive
 * setup calls where a retry loop would just delay degradation (suggestion).
 */
export async function generateStructured<T>(
  options: GenerateStructuredOptions<T>,
): Promise<T> {
  const { registry, provider, modelId, prompt, schema, timeoutMs } = options;
  const languageModel =
    provider === 'openrouter'
      ? registry.openrouter?.chatModel(modelId)
      : registry.local?.(modelId);
  if (!languageModel) {
    throw new ProviderCallError(
      provider,
      modelId,
      new Error(`${provider} provider not configured`),
    );
  }

  try {
    const { output } = await generateText({
      model: languageModel,
      prompt,
      output: Output.object({ schema }),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return output;
  } catch (error) {
    throw new ProviderCallError(provider, modelId, error);
  }
}

function formatCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
