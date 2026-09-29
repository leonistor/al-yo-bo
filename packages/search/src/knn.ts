export interface KnnRecord {
  bookmarkId: string;
  embedding: Uint8Array;
}

export interface KnnHit {
  bookmarkId: string;
  score: number;
  rank: number;
}

export function packFloat32(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setFloat32(i * 4, values[i] ?? 0, true);
  }
  return bytes;
}

export function unpackFloat32(bytes: Uint8Array): Float32Array {
  const values = new Float32Array(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) {
    values[i] = view.getFloat32(i * 4, true);
  }
  return values;
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
 */
export class KnnIndex {
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

  /** Write-through upsert so newly embedded bookmarks are searchable immediately. */
  upsert(bookmarkId: string, embedding: Uint8Array): void {
    const vector = unpackFloat32(embedding);
    if (this.dims === 0) {
      this.dims = vector.length;
    }
    if (vector.length !== this.dims) {
      throw new Error(`Embedding dimension mismatch: expected ${this.dims}, got ${vector.length}`);
    }
    normalize(vector);

    const index = this.ids.indexOf(bookmarkId);
    if (index === -1) {
      const grown = new Float32Array(this.matrix.length + this.dims);
      grown.set(this.matrix);
      grown.set(vector, this.matrix.length);
      this.matrix = grown;
      this.ids.push(bookmarkId);
      return;
    }
    this.matrix.set(vector, index * this.dims);
  }

  search(query: Float32Array, topK: number): KnnHit[] {
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
      .map((hit, index) => ({ ...hit, rank: index + 1 }));
  }
}
