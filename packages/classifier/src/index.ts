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

/** Raw probability per requested question label. */
export type DecideResponse = Record<string, number>;

export interface ClassifierClient {
  decide(request: DecideRequest): Promise<DecideResponse>;
}

export interface OllayaConfig {
  baseUrl: string;
  apiKey?: string;
}

interface OllayaDecideBody {
  model?: string;
  probabilities?: Record<string, number>;
  results?: Array<{ question?: string; label?: string; probability?: number }>;
}

export class OllayaClassifierClient implements ClassifierClient {
  constructor(private readonly config: OllayaConfig) {}

  async decide(request: DecideRequest): Promise<DecideResponse> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/api/decide`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Ollaya decide failed: ${response.status} ${await response.text()}`);
    }

    return normalizeDecideResponse((await response.json()) as OllayaDecideBody);
  }
}

function normalizeDecideResponse(body: OllayaDecideBody): DecideResponse {
  if (body.probabilities) {
    return body.probabilities;
  }
  if (body.results) {
    return Object.fromEntries(
      body.results
        .filter((entry): entry is { question: string; probability: number } => Boolean(entry.question))
        .map((entry) => [entry.question, entry.probability ?? 0]),
    );
  }
  return {};
}
