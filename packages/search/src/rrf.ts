import type { RankedCandidate, SearchMode } from '@al-yo-bo/shared';

/** Reciprocal Rank Fusion constant; 60 is the value used by the original paper and Elasticsearch. */
export const RRF_K = 60;

/**
 * Fuses several ranked candidate lists into one. With a single list (keyword-only,
 * the default when no embeddings exist) the ordering is preserved.
 */
export function reciprocalRankFusion(
  lists: RankedCandidate[][],
  k = RRF_K,
): RankedCandidate[] {
  const scores = new Map<string, number>();
  const snippets = new Map<string, string>();

  for (const list of lists) {
    for (const candidate of list) {
      scores.set(candidate.bookmarkId, (scores.get(candidate.bookmarkId) ?? 0) + 1 / (k + candidate.rank));
      if (candidate.snippet && !snippets.has(candidate.bookmarkId)) {
        snippets.set(candidate.bookmarkId, candidate.snippet);
      }
    }
  }

  return [...scores.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([bookmarkId, score], index) => ({
      bookmarkId,
      rank: index + 1,
      score,
      snippet: snippets.get(bookmarkId),
    }));
}

/**
 * Combines the keyword and semantic candidate lists for the requested mode. A
 * missing semantic list (no embeddings, no key, or not yet loaded) degrades to
 * keyword-only results — a normal state, never an error (ARCHITECTURE §6).
 */
export function fuseSearch(
  keyword: RankedCandidate[],
  semantic: RankedCandidate[],
  mode: SearchMode,
): RankedCandidate[] {
  if (mode === 'semantic') {
    return semantic.length > 0 ? semantic : keyword;
  }
  if (mode === 'hybrid') {
    const lists = [keyword, semantic].filter((list) => list.length > 0);
    return lists.length > 1 ? reciprocalRankFusion(lists) : (lists[0] ?? []);
  }
  return keyword;
}
