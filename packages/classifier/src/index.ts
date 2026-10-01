/**
 * Thin boundary around the Ollaya decision daemon. Ollaya is Beta and pre-1.0,
 * so every call goes through `ClassifierClient` and can be swapped without
 * touching the classification workflow.
 */

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
  } else if (body.results) {
    result.probabilities = Object.fromEntries(
      body.results
        .filter((entry): entry is { question: string; probability: number } => Boolean(entry.question))
        .map((entry) => [entry.question, entry.probability ?? 0]),
    );
  }
  return result;
}

/** Message for a failed fetch; `AbortSignal.timeout` aborts surface as timeouts. */
function describeFetchFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'request timed out';
  }
  return error instanceof Error ? error.message : String(error);
}
