import type { Database } from 'bun:sqlite';

import { createDataset, openDatabase, setupDatabase } from '@al-yo-bo/db';
import type {
  RankedCandidate,
  VectorFilter,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';

import type { CoreConfig } from '../src/config.ts';
import type { JobType } from '../src/enrichment/jobs.ts';
import type { JobScheduler } from '../src/services/enrichment.ts';

/** In-memory database with the full schema applied and a test dataset. */
export function makeDb(datasetName = 'test'): Database & { datasetId: string } {
  const db = openDatabase(':memory:') as Database & { datasetId: string };
  setupDatabase(db);
  db.datasetId = createDataset(db, datasetName).id;
  return db;
}

/** Deterministic VectorIndex stub: candidates come back in insertion order. */
export class StubVectorIndex implements VectorIndex {
  upserts: VectorUpsert[] = [];
  deletions: string[] = [];
  payloads: Array<{ bookmarkId: string; patch: VectorPayloadPatch }> = [];

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
    _filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    return this.ids.slice(0, Math.max(0, topK)).map((bookmarkId, index) => ({
      bookmarkId,
      rank: index + 1,
      score: 1 / (index + 1),
    }));
  }
}

/** EmbeddingClient stub returning a fixed unit-ish vector. */
export const stubEmbeddings = {
  async embed(texts: string[]) {
    return {
      vectors: texts.map(() => Float32Array.from([1, 0, 0])),
      dims: 3,
      model: 'stub',
    };
  },
};

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

/** Config with only the fields core consumes. */
export function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    autoAssignThreshold: 0.5,
    defaultDataset: 'test',
    embeddings: { model: 'stub-model' },
    ollaya: { baseUrl: 'http://127.0.0.1:11435', model: 'laya' },
    scrape: {
      timeoutMs: 15_000,
      maxContentChars: 200_000,
      binary: 'html-to-markdown',
      maxAttempts: 3,
    },
    ...overrides,
  };
}
