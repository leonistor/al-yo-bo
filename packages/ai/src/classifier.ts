/**
 * Ollaya decision-server boundary (ARCHITECTURE §8, ported from the former
 * `packages/classifier`). Ollaya is Beta and pre-1.0, so every call goes
 * through `ClassifierClient` and can be swapped without touching the
 * classification workflow.
 *
 * Unlike the rest of this package this is NOT an AI SDK provider: Ollaya is a
 * decision server (typed `noul` questions → calibrated probabilities), not an
 * LLM gateway — no text generation, no OpenAI-compatible endpoints (§3). The
 * adapter stays a hand-rolled fetch client with its own error taxonomy and
 * timeout, kept verbatim from the v1 port.
 */

import { describeFetchFailure } from '@al-yo-bo/shared';

export interface NoulQuestion {
  type: 'noul';
  instructions?: string;
  criteria?: { true?: string; false?: string };
}

export interface DecideRequest {
  model: string;
  state: string;
  questions: Record<string, NoulQuestion>;
}

/** Raw probability per requested question label, plus the model that answered. */
export interface DecideResult {
  probabilities: Record<string, number>;
  /** Resolved checkpoint returned by the daemon, when reported (persisted in `classification_runs.model`). */
  model?: string;
}

export interface ClassifierClient {
  decide(request: DecideRequest): Promise<DecideResult>;
}

export interface OllayaConfig {
  baseUrl: string;
  apiKey?: string;
  /** Per-request fetch timeout; a hung Ollaya daemon must degrade, not hang the worker. */
  timeoutMs?: number;
}

/** Default request timeout (ms) when `timeoutMs` is not configured. */
const DEFAULT_TIMEOUT_MS = 30_000;

interface OllayaDecideBody {
  model?: string;
  /** Current 0.9 shape: one answer object per label, `noul` = P(true). */
  answers?: Record<string, { type?: string; noul?: number }>;
  probabilities?: Record<string, number>;
  results?: Array<{ question?: string; label?: string; probability?: number }>;
}

export class OllayaClassifierClient implements ClassifierClient {
  constructor(private readonly config: OllayaConfig) {}

  async decide(request: DecideRequest): Promise<DecideResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/api/decide`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      // Network failures and timeout aborts land here; rethrow under the same
      // error message convention so callers skip the job (degraded state §1.5).
      throw new Error(`Ollaya decide failed: ${describeFetchFailure(error)}`, { cause: error });
    }

    if (!response.ok) {
      throw new Error(`Ollaya decide failed: ${response.status} ${await response.text()}`);
    }

    return normalizeDecideResponse((await response.json()) as OllayaDecideBody);
  }
}

function normalizeDecideResponse(body: OllayaDecideBody): DecideResult {
  const result: DecideResult = { probabilities: {}, model: body.model };
  if (body.probabilities) {
    result.probabilities = body.probabilities;
  } else if (body.answers) {
    // Ollaya 0.9: answers.<label>.noul holds the P(true) for each noul question.
    result.probabilities = Object.fromEntries(
      Object.entries(body.answers).map(([label, answer]) => [label, answer.noul ?? 0]),
    );
  } else if (body.results) {
    result.probabilities = Object.fromEntries(
      body.results
        .filter((entry): entry is { question: string; probability: number } =>
          Boolean(entry.question),
        )
        .map((entry) => [entry.question, entry.probability ?? 0]),
    );
  }
  return result;
}
