import type { RankedCandidate, VectorFilter, VectorIndex, VectorPayloadPatch, VectorUpsert } from '@al-yo-bo/shared';

export interface FallbackPayload {
  datasetId: string;
  categoryId: string | null;
  tagIds: string[];
}

export interface FallbackVectorIndexOptions {
  /** Batch-resolves filterable payload for candidate ids (from SQLite) to apply filters on the fallback path. */
  resolvePayloads?: (bookmarkIds: string[]) => Map<string, FallbackPayload>;
  /** Ms the primary is skipped after a failure before the next request retries it. Default 30_000. */
  cooldownMs?: number;
  /** Fallback overfetch multiplier when a filter must be applied client-side. Default 8. */
  overfetchFactor?: number;
}

/** True when every field set on `filter` is satisfied by the resolved payload. */
function matchesFilter(payload: FallbackPayload | undefined, filter: VectorFilter): boolean {
  if (!payload) {
    return false;
  }
  if (filter.datasetId !== undefined && payload.datasetId !== filter.datasetId) {
    return false;
  }
  if (filter.categoryId !== undefined && payload.categoryId !== filter.categoryId) {
    return false;
  }
  if (filter.tagId !== undefined && !payload.tagIds.includes(filter.tagId)) {
    return false;
  }
  return true;
}

/**
 * Routes vector operations to a Qdrant primary with an in-process KNN fallback.
 *
 * SQLite stays canonical: embeddings and payloads are read from the database, so
 * any write the primary missed is repaired by the startup sync. That makes the
 * primary's availability a latency/quality concern, not a correctness one, and
 * lets every operation degrade to the fallback without surfacing errors.
 *
 * After a primary failure the primary is skipped for `cooldownMs`; the next call
 * past the deadline retries it implicitly, which doubles as recovery detection.
 */
export class FallbackVectorIndex implements VectorIndex {
  private readonly resolvePayloads?: (bookmarkIds: string[]) => Map<string, FallbackPayload>;
  private readonly cooldownMs: number;
  private readonly overfetchFactor: number;
  private cooldownUntil = 0;
  private warned = false;

  constructor(
    private primary: VectorIndex,
    private fallback: VectorIndex,
    options: FallbackVectorIndexOptions = {},
  ) {
    this.resolvePayloads = options.resolvePayloads;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.overfetchFactor = options.overfetchFactor ?? 8;
  }

  get size(): number {
    return Math.max(this.primary.size, this.fallback.size);
  }

  private get primaryAvailable(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  private notePrimarySuccess(): void {
    this.warned = false;
  }

  private handlePrimaryFailure(operation: string, error: unknown): void {
    if (!this.warned) {
      console.warn(
        `[FallbackVectorIndex] primary ${operation} failed; using in-process fallback for ${this.cooldownMs}ms`,
        error,
      );
      this.warned = true;
    }
    this.cooldownUntil = Date.now() + this.cooldownMs;
  }

  async search(
    query: Float32Array,
    topK: number,
    filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    if (this.primaryAvailable) {
      try {
        const hits = await this.primary.search(query, topK, filter);
        this.notePrimarySuccess();
        return hits;
      } catch (error) {
        this.handlePrimaryFailure('search', error);
      }
    }
    return this.searchFallback(query, topK, filter);
  }

  /**
   * The in-memory fallback cannot filter server-side, and its scan is exhaustive.
   * Overfetching widens the window before the client-side filter, so the only
   * candidates lost are matches that would have ranked below that window anyway.
   */
  private async searchFallback(
    query: Float32Array,
    topK: number,
    filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    if (!filter || !this.resolvePayloads) {
      return this.fallback.search(query, topK);
    }

    const candidates = await this.fallback.search(query, topK * this.overfetchFactor);
    const payloads = this.resolvePayloads(candidates.map((candidate) => candidate.bookmarkId));
    return candidates
      .filter((candidate) => matchesFilter(payloads.get(candidate.bookmarkId), filter))
      .slice(0, Math.max(0, topK));
  }

  async upsert(point: VectorUpsert): Promise<void> {
    await this.dualWrite('upsert', (index) => index.upsert(point));
  }

  async updatePayload(bookmarkId: string, patch: VectorPayloadPatch): Promise<void> {
    await this.dualWrite('updatePayload', (index) => index.updatePayload(bookmarkId, patch));
  }

  async delete(bookmarkId: string): Promise<void> {
    await this.dualWrite('delete', (index) => index.delete(bookmarkId));
  }

  /** Best-effort dual write: primary errors are swallowed (and trigger cooldown), fallback errors too. */
  private async dualWrite(
    operation: string,
    task: (index: VectorIndex) => Promise<void>,
  ): Promise<void> {
    if (this.primaryAvailable) {
      try {
        await task(this.primary);
        this.notePrimarySuccess();
      } catch (error) {
        this.handlePrimaryFailure(operation, error);
      }
    }
    try {
      await task(this.fallback);
    } catch (error) {
      console.warn(`[FallbackVectorIndex] fallback ${operation} failed`, error);
    }
  }
}
