import type { RankedCandidate } from './types.ts';

/**
 * Payload stored alongside each vector. It mirrors the bookmark's filterable
 * state — including its dataset, so the vector engine can enforce the dataset
 * boundary (MODEL.md principle 1) inside the top-k query (server-side) instead
 * of after fusion.
 */
export interface VectorPayload {
  model: string;
  dims: number;
  /** Dataset the point's bookmark belongs to; never changes for a point. */
  datasetId: string;
  categoryId: string | null;
  tagIds: string[];
}

/**
 * Filter pushed into the vector query. All present values are ANDed, matching
 * the keyword search semantics. `datasetId` is always set by the search
 * service — semantic search is dataset-scoped like keyword search.
 */
export interface VectorFilter {
  datasetId?: string;
  categoryId?: string;
  tagId?: string;
}

export interface VectorUpsert {
  bookmarkId: string;
  vector: Float32Array;
  payload: VectorPayload;
}

/** Partial payload update (e.g. tags changed after the point was written). */
export interface VectorPayloadPatch {
  categoryId?: string | null;
  tagIds?: string[];
}

/**
 * A vector index serving top-k cosine search over bookmark embeddings.
 * Implementations: `QdrantIndex` (sidecar, packages/vectordb) and `KnnIndex`
 * (in-process brute force, packages/search — also the offline fallback).
 * Vectors arrive as unnormalized `Float32Array`; implementations normalize
 * internally where needed (cosine is scale-invariant for ranking).
 */
export interface VectorIndex {
  /** Number of vectors currently indexed; 0 means semantic search is off. */
  readonly size: number;

  /** Idempotent write-through of one embedding point. */
  upsert(point: VectorUpsert): Promise<void>;

  /** Merge a payload patch into an existing point (missing point: no-op). */
  updatePayload(bookmarkId: string, patch: VectorPayloadPatch): Promise<void>;

  /** Remove a point (missing point: no-op). */
  delete(bookmarkId: string): Promise<void>;

  /**
   * Top-k nearest neighbours by cosine similarity. With a filter, results must
   * satisfy it. Returns candidates ordered best-first with 1-based ranks.
   */
  search(query: Float32Array, topK: number, filter?: VectorFilter): Promise<RankedCandidate[]>;
}
