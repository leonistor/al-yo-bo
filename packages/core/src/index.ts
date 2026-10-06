/**
 * Public surface of `@al-yo-bo/core`: a transport-neutral domain/application
 * service layer. The app edge (apps/server) maps HTTP onto these services,
 * owns the concrete Qdrant/AI-layer/scraper construction, and is the only
 * consumer of the events sink (core is the only emission layer — §9).
 */

export { createCore, type Core, type CoreDeps } from './create-core.ts';
export type { CoreAi } from './ai.ts';
export { noopEvents, type EventsSink } from './events.ts';
export type { CoreConfig } from './config.ts';

export {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnavailableError,
  UpstreamError,
  ScrapeUnavailableError,
  ScrapeFailedError,
  ClassifyUnavailableError,
  ClassifyFailedError,
  ChatUnavailableError,
  type DomainErrorCode,
} from './errors.ts';

export type { BookmarkHit } from './dto.ts';

export { createVectorProvider, type VectorProvider } from './vector/provider.ts';
export { syncVectorPayload } from './vector/sync.ts';

export {
  createSearchService,
  type SearchService,
  type SearchServiceDeps,
  type SearchInput,
} from './services/search.ts';
export {
  createBookmarkService,
  type BookmarkService,
  type BookmarkServiceDeps,
  type BookmarkInput,
  type BookmarkPatch,
} from './services/bookmarks.ts';
export {
  createVocabularyService,
  type VocabularyService,
  type VocabularyServiceDeps,
  type CategoryInput,
  type CategoryPatch,
  type TagInput,
  type TagPatch,
} from './services/vocabulary.ts';
export {
  createReviewService,
  type ReviewService,
  type ReviewServiceDeps,
} from './services/review.ts';
export {
  createImportService,
  type ImportService,
  type ImportServiceDeps,
  type ImportOptions,
  type ImportPreview,
} from './services/import.ts';
export {
  createExportService,
  type ExportService,
  type ExportServiceDeps,
} from './services/export.ts';
export {
  createEnrichmentService,
  type EnrichmentService,
  type EnrichmentServiceDeps,
  type ScrapeResponse,
  type ClassifyResponse,
  type ScreenshotResponse,
  type JobScheduler,
} from './services/enrichment.ts';
export {
  createProfileService,
  type AvatarStore,
  type AvatarFile,
  type ProfileService,
  type ProfileServiceDeps,
  type ProfilePatchInput,
} from './services/profile.ts';
export {
  createHealthService,
  type HealthService,
  type HealthServiceDeps,
  type HealthReport,
  type HealthJobs,
} from './services/health.ts';
export { bookmarkView, bookmarkViewOrThrow, requireBookmark } from './services/_views.ts';

// Enrichment primitives, re-exported so the app edge can construct capabilities
// (scraper, queue reconciliation) without importing core internals by path.
export {
  composeEmbedText,
  scrapeAndStore,
  embedBookmark,
  startJobQueue,
  reconcileEnrichment,
  EMBED_TEXT_CHAR_LIMIT,
  type JobDeps,
  type JobQueue,
  type JobQueueOptions,
  type JobType,
  type ReconcileReport,
  type ScrapeOutcome,
  type EmbedOutcome,
} from './enrichment/jobs.ts';
export {
  buildStateString,
  buildQuestions,
  classifyBookmark,
  MAX_QUESTIONS_PER_CALL,
  STATE_EXCERPT_CHARS,
  type ClassifyDeps,
  type ClassifyOutcome,
} from './enrichment/classify.ts';
export {
  makeScraper,
  fetchPageHtml,
  convertHtmlToMarkdown,
  sha256Hex,
  ScrapeError,
  type ScrapeFn,
  type ScrapeResult,
  type FetchedPage,
} from './scrape.ts';
export { type ScreenshotClient, type ScreenshotResult } from './screenshot.ts';
