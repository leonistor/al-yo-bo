import type { Database } from 'bun:sqlite';

import { rebuildFts } from '@al-yo-bo/db';
import type { ClassifierClient } from '@al-yo-bo/classifier';
import type { EmbeddingClient } from '@al-yo-bo/embeddings';

import type { CoreConfig } from './config.ts';
import type { ScrapeFn } from './scrape.ts';
import type { VectorProvider } from './vector/provider.ts';
import { createSearchService, type SearchService } from './services/search.ts';
import { createBookmarkService, type BookmarkService } from './services/bookmarks.ts';
import { createVocabularyService, type VocabularyService } from './services/vocabulary.ts';
import { createReviewService, type ReviewService } from './services/review.ts';
import { createImportService, type ImportService } from './services/import.ts';
import {
  createEnrichmentService,
  type EnrichmentService,
} from './services/enrichment.ts';
import { createHealthService, type HealthService } from './services/health.ts';

export interface CoreDeps {
  db: Database;
  config: CoreConfig;
  vector: VectorProvider;
  embeddings?: EmbeddingClient;
  classifier?: ClassifierClient;
  scrape?: ScrapeFn;
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
  const { db, config, vector, embeddings, classifier, scrape } = deps;

  const enrichment = createEnrichmentService({
    db,
    config,
    vector,
    embeddings,
    classifier,
    scrape,
    maxAttempts: deps.maxAttempts,
  });

  return {
    search: createSearchService({ db, config, vector, embeddings }),
    bookmarks: createBookmarkService({ db, jobs: enrichment, vector }),
    vocabulary: createVocabularyService({ db, jobs: enrichment }),
    review: createReviewService({ db, config, vector }),
    import: createImportService({ db, jobs: enrichment }),
    enrichment,
    health: createHealthService({ vector, config, embeddings, jobs: enrichment, scrape, classifier }),
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
