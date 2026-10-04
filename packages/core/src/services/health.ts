import type { AiHealthReport } from '@al-yo-bo/ai';

import type { CoreAi } from '../ai.ts';
import type { CoreConfig } from '../config.ts';
import type { ScrapeFn } from '../scrape.ts';
import type { ScreenshotClient } from '../screenshot.ts';
import type { VectorProvider } from '../vector/provider.ts';

/**
 * Package version read once from the manifest at module load. The Bun bundler
 * inlines the JSON import as a literal, so this is a constant at runtime; a
 * missing manifest (extremely unlikely) still falls back to `'0.0.0'` so the
 * service shape stays total.
 */
const PACKAGE_VERSION: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manifest = require('../../package.json') as { version?: string };
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** Minimal view of the queue needed for reporting; avoids depending on the queue type. */
export interface HealthJobs {
  pendingCount(): number;
}

export interface HealthReport {
  status: 'ok';
  version: string;
  vector: {
    backend: 'qdrant' | 'memory';
    indexed: number;
  };
  /**
   * AI-layer capability probes (ARCHITECTURE §8): ollaya/ollama reachability,
   * chat availability, embeddings/classifier/extract configuration. Composed
   * from the injected layer so core never re-implements a probe.
   */
  ai: AiHealthReport;
  enrichment: {
    /** The scraper is injected AND its html-to-markdown binary resolves on PATH. */
    scrapeAvailable: boolean;
    jobsPending: number;
  };
  screenshot: {
    available: boolean;
  };
}

export interface HealthServiceDeps {
  vector: VectorProvider;
  config: CoreConfig;
  ai: CoreAi;
  jobs?: HealthJobs;
  scrape?: ScrapeFn;
  /** Screenshot capture port; absent = screenshot jobs are a no-op. */
  screenshot?: ScreenshotClient | null;
  /** Binary resolution override (tests); defaults to Bun.which. */
  hasBinary?: (binary: string) => boolean;
}

export interface HealthService {
  health(): Promise<HealthReport>;
}

/**
 * Aggregates the optional-subsystem capability report into a single value the
 * app edge can serialize directly (ARCHITECTURE §1.5: every sidecar is
 * optional, so health is descriptive rather than a liveness gate). The AI
 * probes come from the injected layer (§8); Qdrant reachability is reported as
 * the vector backend label + indexed count; the scrape check resolves the
 * html-to-markdown binary exactly like the scrape ladder does (§10).
 */
export function createHealthService(deps: HealthServiceDeps): HealthService {
  const { vector, config, ai, jobs, scrape, screenshot } = deps;
  // Bun.which returns null (not '') when the binary is missing.
  const hasBinary = deps.hasBinary ?? ((binary: string) => Bun.which(binary) !== null);

  return {
    async health() {
      const index = vector.current();
      return {
        status: 'ok' as const,
        version: PACKAGE_VERSION,
        vector: {
          backend: vector.backend(),
          indexed: index.size,
        },
        ai: await ai.health.report(),
        enrichment: {
          scrapeAvailable: Boolean(scrape) && hasBinary(config.scrape.binary),
          jobsPending: jobs?.pendingCount() ?? 0,
        },
        screenshot: {
          available: Boolean(screenshot),
        },
      };
    },
  };
}
