import type {
  RankedCandidate,
  VectorFilter,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';
import { unpackFloat32 } from '@al-yo-bo/shared';

export { packFloat32, unpackFloat32 } from '@al-yo-bo/shared';

export interface KnnRecord {
  bookmarkId: string;
  embedding: Uint8Array;
}

function normalize(values: Float32Array): void {
  let norm = 0;
  for (const value of values) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return;
  }
  for (let i = 0; i < values.length; i++) {
    values[i] = (values[i] ?? 0) / norm;
  }
}

/**
 * In-process brute-force KNN over embeddings loaded into one contiguous matrix.
 * Vectors are normalized once, so cosine similarity is a dot product. At personal
 * scale this is millisecond-level and dependency-free (ARCHITECTURE §6).
 *
 * Implements `VectorIndex` so it can serve as the offline fallback when Qdrant is
 * unreachable, and as the primary index when the sidecar is not configured.
 */
export class KnnIndex implements VectorIndex {
  private dims = 0;
  private ids: string[] = [];
  private matrix = new Float32Array(0);

  get size(): number {
    return this.ids.length;
  }

  get dimensions(): number {
    return this.dims;
  }

  load(records: KnnRecord[]): void {
    const first = records[0];
    if (!first) {
      this.dims = 0;
      this.ids = [];
      this.matrix = new Float32Array(0);
      return;
    }

    const dims = first.embedding.byteLength / 4;
    const matrix = new Float32Array(records.length * dims);

    records.forEach((record, index) => {
      const vector = unpackFloat32(record.embedding);
      if (vector.length !== dims) {
        throw new Error(`Embedding dimension mismatch: expected ${dims}, got ${vector.length}`);
      }
      normalize(vector);
      matrix.set(vector, index * dims);
    });

    this.dims = dims;
    this.ids = records.map((record) => record.bookmarkId);
    this.matrix = matrix;
  }

  /**
   * Write-through upsert so newly embedded bookmarks are searchable immediately.
   * The payload is ignored: the in-memory index stores only vectors, and SQLite
   * remains canonical for category/tag filters.
   *
   * Normalizes a copy of the vector: `point.vector` may alias the durable
   * embedding bytes (e.g. the buffer staged for the SQLite write), so mutating
   * it in place would corrupt the source of truth.
   */
  async upsert(point: VectorUpsert): Promise<void> {
    const vector = point.vector;
    if (this.dims === 0) {
      this.dims = vector.length;
    }
    if (vector.length !== this.dims) {
      throw new Error(`Embedding dimension mismatch: expected ${this.dims}, got ${vector.length}`);
    }
    const normalized = Float32Array.from(vector);
    normalize(normalized);

    const index = this.ids.indexOf(point.bookmarkId);
    if (index === -1) {
      const grown = new Float32Array(this.matrix.length + this.dims);
      grown.set(this.matrix);
      grown.set(normalized, this.matrix.length);
      this.matrix = grown;
      this.ids.push(point.bookmarkId);
      return;
    }
    this.matrix.set(normalized, index * this.dims);
  }

  /**
   * Deliberate no-op: the in-memory index carries no payloads, so payload-only
   * updates are irrelevant here (SQLite is canonical).
   */
  async updatePayload(_bookmarkId: string, _patch: VectorPayloadPatch): Promise<void> {}

  /** Removes a row by rebuilding the matrix without it; dims stays unchanged. */
  async delete(bookmarkId: string): Promise<void> {
    const index = this.ids.indexOf(bookmarkId);
    if (index === -1) {
      return;
    }

    const rebuilt = new Float32Array(this.matrix.length - this.dims);
    const before = index * this.dims;
    rebuilt.set(this.matrix.subarray(0, before));
    rebuilt.set(this.matrix.subarray(before + this.dims), before);

    this.matrix = rebuilt;
    this.ids.splice(index, 1);
  }

  /**
   * Top-k by cosine similarity. The `filter` argument is ignored: the in-memory
   * matrix stores no payloads, so category/tag filtering is applied by the caller
   * (FallbackVectorIndex) after the scan.
   */
  async search(
    query: Float32Array,
    topK: number,
    _filter?: VectorFilter,
  ): Promise<RankedCandidate[]> {
    if (this.ids.length === 0) {
      return [];
    }
    if (query.length !== this.dims) {
      throw new Error(`Query dimension mismatch: expected ${this.dims}, got ${query.length}`);
    }

    const normalized = Float32Array.from(query);
    normalize(normalized);

    const hits: { bookmarkId: string; score: number }[] = this.ids.map((bookmarkId, index) => {
      const offset = index * this.dims;
      let score = 0;
      for (let d = 0; d < this.dims; d++) {
        score += (normalized[d] ?? 0) * (this.matrix[offset + d] ?? 0);
      }
      return { bookmarkId, score };
    });

    return hits
      .toSorted((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK))
      .map((hit, index) => ({ bookmarkId: hit.bookmarkId, score: hit.score, rank: index + 1 }));
  }
}
