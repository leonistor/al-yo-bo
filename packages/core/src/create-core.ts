import type { Database } from 'bun:sqlite';

import { rebuildFts } from '@al-yo-bo/db';

import type { CoreAi } from './ai.ts';
import type { CoreConfig } from './config.ts';
import { noopEvents, type EventsSink } from './events.ts';
import type { ScrapeFn } from './scrape.ts';
import type { ScreenshotClient } from './screenshot.ts';
import { createBookmarkService, type BookmarkService } from './services/bookmarks.ts';
import { createEnrichmentService, type EnrichmentService } from './services/enrichment.ts';
import { createExportService, type ExportService } from './services/export.ts';
import { createHealthService, type HealthService } from './services/health.ts';
import { createImportService, type ImportService } from './services/import.ts';
import { createProfileService, type AvatarStore, type ProfileService } from './services/profile.ts';
import { createSearchService, type SearchService } from './services/search.ts';
import { createSetupService, type SetupService } from './services/setup.ts';
import { createVocabularyService, type VocabularyService } from './services/vocabulary.ts';
import type { VectorProvider } from './vector/provider.ts';

export interface CoreDeps {
  db: Database;
  config: CoreConfig;
  /**
   * AI capabilities (ARCHITECTURE §4 interface/adapter split): the app edge
   * passes its built `AiLayer`; core consumes only the interfaces.
   */
  ai: CoreAi;
  vector: VectorProvider;
  /** Absent = the manual scrape endpoint reports unavailable and scrape jobs fail. */
  scrape?: ScrapeFn;
  /** Screenshot capture port; absent = screenshot job is a no-op. */
  screenshot?: ScreenshotClient | null;
  /** Absolute path the screenshot job writes image bytes to. */
  screenshotsDir?: string;
  /** Avatar write port (data-root file); absent = avatar upload is rejected. */
  avatarStore?: AvatarStore;
  /**
   * Event sink for the coarse domain events (ARCHITECTURE §9/H5). Core services
   * are the only emitters; the server injects the bus that fans events out over
   * SSE. Defaults to a no-op so tests stay simple.
   */
  events?: EventsSink;
  maxAttempts?: number;
  baseDelayMs?: number;
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
  setup: SetupService;
  import: ImportService;
  export: ExportService;
  enrichment: EnrichmentService;
  health: HealthService;
  /** The single user's profile (identity only — MODEL.md principle 8). */
  profile: ProfileService;
  /** Rebuilds FTS rows, then the vector stack via the injected callback (§6). */
  reindex(): Promise<{ ftsRows: number; vectorBackend: 'qdrant' | 'memory' }>;
  /** Stops the enrichment queue; callers also close their own db. */
  stop(): void;
  /**
   * Resolves when no enrichment job is queued or running. `stop()` only flags
   * the in-flight job — callers about to close the db should await this
   * (behind a timeout) first, so no job writes into a closing database.
   */
  waitForIdle(): Promise<void>;
}

/**
 * Composition root for the domain/application layer. Plain factory, no DI
 * container: it constructs enrichment first so the same instance can serve both
 * as the scheduler other services enqueue onto and as the manual
 * scrape/classify/reconcile surface. Services never construct each other, and
 * every service receives the same events sink — core is the only event-emission
 * layer (ARCHITECTURE §4/§9). One workspace: there is no scoping resolution
 * anywhere (MODEL.md principle 1).
 */
export function createCore(deps: CoreDeps): Core {
  const { db, config, ai, vector, scrape, screenshot, events: eventsSink } = deps;
  const events = eventsSink ?? noopEvents();

  const enrichment = createEnrichmentService({
    db,
    config,
    ai,
    vector,
    scrape,
    screenshot: screenshot ?? null,
    screenshotsDir: deps.screenshotsDir,
    maxAttempts: deps.maxAttempts,
    baseDelayMs: deps.baseDelayMs,
    events,
  });

  return {
    search: createSearchService({ db, config, vector, embeddings: ai.embeddings ?? undefined }),
    bookmarks: createBookmarkService({
      db,
      jobs: enrichment,
      vector,
      events,
      screenshotsDir: deps.screenshotsDir,
    }),
    vocabulary: createVocabularyService({ db, jobs: enrichment, vector, events }),
    setup: createSetupService({ db, ai }),
    import: createImportService({ db, jobs: enrichment, extract: ai.extract, events }),
    export: createExportService({ db }),
    enrichment,
    profile: createProfileService({ db, avatarStore: deps.avatarStore, events }),
    health: createHealthService({
      vector,
      config,
      ai,
      jobs: enrichment,
      scrape,
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
    waitForIdle: () => enrichment.waitForIdle(),
  };
}
