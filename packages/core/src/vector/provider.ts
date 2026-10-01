import type { VectorIndex } from '@al-yo-bo/shared';

/**
 * Holds the currently-serving vector index behind a stable reference. Services
 * read `current()` at the point of use (never capture the index at construction)
 * so a `reindex` that hot-swaps the serving stack is observed by the next call.
 * The backend label is reporting-only (e.g. `/api/health`).
 */
export interface VectorProvider {
  current(): VectorIndex;
  backend(): 'qdrant' | 'memory';
  replace(index: VectorIndex, backend: 'qdrant' | 'memory'): void;
}

export function createVectorProvider(
  initial: VectorIndex,
  backend: 'qdrant' | 'memory',
): VectorProvider {
  let index = initial;
  let currentBackend = backend;
  return {
    current: () => index,
    backend: () => currentBackend,
    replace: (next, nextBackend) => {
      index = next;
      currentBackend = nextBackend;
    },
  };
}
