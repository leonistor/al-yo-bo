import type { Database } from 'bun:sqlite';

import type { ClassifierClient } from '@al-yo-bo/classifier';
import { createDataset, getDatasetByName, rebuildFts } from '@al-yo-bo/db';
import type { EmbeddingClient } from '@al-yo-bo/embeddings';
import type { ExtractionClient } from '@al-yo-bo/importer';

import type { CoreConfig } from './config.ts';
import type { ScrapeFn } from './scrape.ts';
import type { ScreenshotClient } from './screenshot.ts';
import { createBookmarkService, type BookmarkService } from './services/bookmarks.ts';
import { createEnrichmentService, type EnrichmentService } from './services/enrichment.ts';
import { createHealthService, type HealthService } from './services/health.ts';
import { createImportService, type ImportService } from './services/import.ts';
import { createReviewService, type ReviewService } from './services/review.ts';
import { createSearchService, type SearchService } from './services/search.ts';
import { createVocabularyService, type VocabularyService } from './services/vocabulary.ts';
import type { VectorProvider } from './vector/provider.ts';

export interface CoreDeps {
  db: Database;
  config: CoreConfig;
  vector: VectorProvider;
  embeddings?: EmbeddingClient;
  classifier?: ClassifierClient;
  scrape?: ScrapeFn;
  /** LLM extraction port for the import page; `null` falls back to the deterministic parser. */
  extract?: ExtractionClient | null;
  /** Screenshot capture port; absent = screenshot job is a no-op. */
  screenshot?: ScreenshotClient | null;
  /** Absolute path the screenshot job writes image bytes to. */
  screenshotsDir?: string;
  maxAttempts?: number;
  /**
   * Rebuilds the vector serving stack from SQLite and hot-swaps it. The app edge
   * owns concrete Qdrant construction, so it injects this callback; without it
   * `reindex` still rebuilds FTS and reports the current provider backend. Keeps
   * core free of any `@al-yo-bo/vectordb` dependency.
   */
  reindex?: () => Promise<{ vectorBackend: 'qdrant' | 'memory' }>;
}

export interface Core {
  search: SearchService;
  bookmarks: BookmarkService;
  vocabulary: VocabularyService;
  review: ReviewService;
  import: ImportService;
  enrichment: EnrichmentService;
  health: HealthService;
  /** The default dataset id (config `defaultDataset`), for routes that need it. */
  defaultDatasetId: string;
  /** Rebuilds FTS rows, then the vector stack via the injected callback (§8). */
  reindex(): Promise<{ ftsRows: number; vectorBackend: 'qdrant' | 'memory' }>;
  /** Stops the enrichment queue; callers also close their own db. */
  stop(): void;
}

/**
 * Composition root for the domain/application layer. Plain factory, no DI
 * container: it constructs enrichment first so the same instance can serve both
 * as the scheduler other services enqueue onto and as the manual
 * scrape/classify/reconcile surface. Services never construct each other.
 */
export function createCore(deps: CoreDeps): Core {
  const { db, config, vector, embeddings, classifier, scrape, extract, screenshot } = deps;

  // The default dataset is the scoping boundary for everything that does not
  // name one explicitly (bookmark CRUD, searches, review queues, imports).
  const dataset =
    getDatasetByName(db, config.defaultDataset) ?? createDataset(db, config.defaultDataset);

  const enrichment = createEnrichmentService({
    db,
    config,
    vector,
    embeddings,
    classifier,
    scrape,
    screenshot: screenshot ?? null,
    screenshotsDir: deps.screenshotsDir,
    maxAttempts: deps.maxAttempts,
  });

  return {
    search: createSearchService({ db, config, vector, embeddings, datasetId: dataset.id }),
    bookmarks: createBookmarkService({ db, jobs: enrichment, vector, datasetId: dataset.id }),
    vocabulary: createVocabularyService({ db, jobs: enrichment, datasetId: dataset.id }),
    review: createReviewService({ db, config, vector, datasetId: dataset.id }),
    import: createImportService({ db, jobs: enrichment, extract: extract ?? null }),
    enrichment,
    defaultDatasetId: dataset.id,
    health: createHealthService({
      vector,
      config,
      embeddings,
      jobs: enrichment,
      scrape,
      classifier,
      extract: extract ?? null,
      screenshot: screenshot ?? null,
    }),
    async reindex() {
      const ftsRows = rebuildFts(db);
      const { vectorBackend } = deps.reindex
        ? await deps.reindex()
        : { vectorBackend: vector.backend() };
      return { ftsRows, vectorBackend };
    },
    stop: () => enrichment.stop(),
  };
}
