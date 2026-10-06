import type { Database } from 'bun:sqlite';

import type { AiHealth, AiHealthReport, ClassifierClient, EmbeddingClient, SuggestClient } from '@al-yo-bo/ai';
import { openDatabase, setupDatabase } from '@al-yo-bo/db';
import type {
  DomainEvent,
  RankedCandidate,
  VectorFilter,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';

import type { CoreAi } from '../src/ai.ts';
import type { CoreConfig } from '../src/config.ts';
import type { JobType } from '../src/enrichment/jobs.ts';
import type { EventsSink } from '../src/events.ts';
import type { JobScheduler } from '../src/services/enrichment.ts';

/** In-memory database with the full schema applied (one workspace — no dataset). */
export function makeDb(): Database {
  const db = openDatabase(':memory:');
  setupDatabase(db);
  return db;
}

/** Deterministic VectorIndex stub: candidates come back in insertion order. */
export class StubVectorIndex implements VectorIndex {
  upserts: VectorUpsert[] = [];
  deletions: string[] = [];
  payloads: Array<{ bookmarkId: string; patch: VectorPayloadPatch }> = [];
  /** Every filter handed to `search`, for asserting what was pushed down. */
  searchFilters: Array<VectorFilter | undefined> = [];

  constructor(public ids: string[] = []) {}

  get size(): number {
    return this.ids.length;
  }

  async upsert(point: VectorUpsert): Promise<void> {
    this.upserts.push(point);
    if (!this.ids.includes(point.bookmarkId)) {
      this.ids.push(point.bookmarkId);
    }
  }

  async updatePayload(bookmarkId: string, patch: VectorPayloadPatch): Promise<void> {
    this.payloads.push({ bookmarkId, patch });
  }

  async delete(bookmarkId: string): Promise<void> {
    this.deletions.push(bookmarkId);
    this.ids = this.ids.filter((id) => id !== bookmarkId);
  }

  async search(
    _query: Float32Array,
    topK: number,
    filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    this.searchFilters.push(filter);
    return this.ids.slice(0, Math.max(0, topK)).map((bookmarkId, index) => ({
      bookmarkId,
      rank: index + 1,
      score: 1 / (index + 1),
    }));
  }
}

/** EmbeddingClient stub returning a fixed unit-ish vector. */
export const stubEmbeddings: EmbeddingClient = {
  async embed(texts: string[]) {
    return {
      vectors: texts.map(() => Float32Array.from([1, 0, 0])),
      dims: 3,
      model: 'stub',
    };
  },
};

/** ClassifierClient stub that records decide calls and answers canned probabilities. */
export function stubClassifier(
  probabilities: Record<string, number>,
  calls: Array<{ state: string; questions: Record<string, unknown> }> = [],
): ClassifierClient {
  return {
    async decide(request) {
      calls.push({ state: request.state, questions: request.questions });
      return { probabilities, model: 'laya:en' };
    },
  };
}

/** Records `enqueue` calls without running anything. */
export function recordingJobs(): JobScheduler & { calls: Array<{ id: string; type: JobType }> } {
  const calls: Array<{ id: string; type: JobType }> = [];
  return {
    calls,
    enqueue(id, type) {
      calls.push({ id, type });
    },
  };
}

/** Collects the coarse domain events core emits (ARCHITECTURE §9). */
export function recordingEvents(): EventsSink & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}

/** Static AiHealth fake for the health-report composition. */
export function fakeAiHealth(report: Partial<AiHealthReport> = {}): AiHealth {
  return {
    async report() {
      return {
        ollayaReachable: false,
        ollamaReachable: false,
        chatAvailable: false,
        chatModel: null,
        embeddingsConfigured: true,
        embeddingModel: 'stub-model',
        classifierModel: 'laya',
        extractConfigured: false,
        extractModel: null,
        ...report,
      };
    },
  };
}

/** SuggestClient stub returning a fixed suggestion. */
export function stubSuggest(suggestion: { tags: string[]; categories: string[][] }): SuggestClient {
  return {
    async suggest() {
      return {
        tags: suggestion.tags.map((name) => ({ name })),
        categories: suggestion.categories.map((path) => ({ path })),
      };
    },
  };
}

/** CoreAi fake — embeddings on, classifier/extract/suggest off, static health probes. */
export function stubAi(overrides: Partial<CoreAi> = {}): CoreAi {
  return {
    embeddings: stubEmbeddings,
    classifier: null,
    extract: null,
    suggest: null,
    health: fakeAiHealth(),
    ...overrides,
  };
}

/** Config with only the fields core consumes (no dataset axis — MODEL.md principle 1). */
export function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    autoAssignThreshold: 0.7,
    embeddings: { model: 'stub-model' },
    ollaya: { model: 'laya' },
    scrape: {
      timeoutMs: 15_000,
      maxContentChars: 200_000,
      binary: 'html-to-markdown',
      maxAttempts: 3,
      maxBytes: 5 * 1024 * 1024,
    },
    ...overrides,
  };
}
