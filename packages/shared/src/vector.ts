import type { RankedCandidate } from './types.ts';

/**
 * Payload stored alongside each vector. It mirrors the bookmark's filterable
 * state so the vector engine can apply category/tag filters inside the top-k
 * query (server-side) instead of after fusion.
 */
export interface VectorPayload {
  model: string;
  dims: number;
  categoryId: string | null;
  tagIds: string[];
}

/**
 * Filter pushed into the vector query. Both values are optional; when both are
 * present they are ANDed, matching the keyword search semantics.
 */
export interface VectorFilter {
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
