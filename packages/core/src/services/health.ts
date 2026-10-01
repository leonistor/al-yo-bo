import type { ClassifierClient } from '@al-yo-bo/classifier';
import type { EmbeddingClient } from '@al-yo-bo/embeddings';

import type { CoreConfig } from '../config.ts';
import type { ScrapeFn } from '../scrape.ts';
import type { VectorProvider } from '../vector/provider.ts';

/** Minimal view of the queue needed for reporting; avoids depending on the queue type. */
export interface HealthJobs {
  pendingCount(): number;
}

/** Optional chat availability supplied by the app edge (core does not own chat config). */
export interface ChatHealth {
  available: boolean;
  model: string | null;
}

export interface HealthReport {
  status: 'ok';
  version: '0.0.0';
  vector: {
    backend: 'qdrant' | 'memory';
    indexed: number;
  };
  embeddings: {
    enabled: boolean;
    model: string | null;
  };
  enrichment: {
    scrapeAvailable: boolean;
    jobsPending: number;
  };
  classifier: {
    available: boolean;
    model: string;
    reachable: boolean;
  };
  chat: ChatHealth;
}

export interface HealthServiceDeps {
  vector: VectorProvider;
  config: CoreConfig;
  embeddings?: EmbeddingClient;
  jobs?: HealthJobs;
  scrape?: ScrapeFn;
  classifier?: ClassifierClient;
}

export interface HealthService {
  /**
   * `chat` is passed per call rather than stored on the long-lived service: core
   * has no chat config of its own, and the app edge is the only owner of that
   * concern. Defaults to unavailable so core can report health standalone.
   */
  health(chat?: ChatHealth): Promise<HealthReport>;
}

/** Cached Ollaya reachability probe (health only; 30 s TTL, sub-second timeout). */
const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 750;
const DEFAULT_CHAT: ChatHealth = { available: false, model: null };

/**
 * Aggregates the optional-subsystem capability report into a single value the
 * app edge can serialize directly (ARCHITECTURE §1.5: every sidecar is optional,
 * so health is descriptive rather than a liveness gate). Reachability probing is
 * per-instance state — a server may run several cores (e.g. tests) without the
 * probes clobbering each other.
 */
export function createHealthService(deps: HealthServiceDeps): HealthService {
  const { vector, config, embeddings, jobs, scrape, classifier } = deps;
  let probe: { at: number; reachable: boolean } | null = null;

  async function probeOllaya(): Promise<boolean> {
    if (probe && Date.now() - probe.at < PROBE_TTL_MS) {
      return probe.reachable;
    }
    let reachable = false;
    try {
      const response = await fetch(config.ollaya.baseUrl.replace(/\/$/, '') + '/', {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      reachable = response.status < 500;
    } catch {
      reachable = false;
    }
    probe = { at: Date.now(), reachable };
    return reachable;
  }

  return {
    async health(chat = DEFAULT_CHAT) {
      const index = vector.current();
      return {
        status: 'ok' as const,
        version: '0.0.0' as const,
        vector: {
          backend: vector.backend(),
          indexed: index.size,
        },
        embeddings: {
          enabled: Boolean(embeddings),
          model: config.embeddings.model ?? null,
        },
        enrichment: {
          scrapeAvailable: Boolean(scrape),
          jobsPending: jobs?.pendingCount() ?? 0,
        },
        classifier: {
          available: Boolean(classifier),
          model: config.ollaya.model,
          reachable: classifier ? await probeOllaya() : false,
        },
        chat,
      };
    },
  };
}
