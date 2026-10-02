/**
 * Recent queries backing the command palette's "Recent searches" group.
 *
 * Storage key: `al-yo-bo:recent-queries`
 * Format: JSON-encoded array of trimmed, non-empty query strings. Newest first,
 * deduplicated, capped at `MAX_RECENT` (8). Invalid or missing storage is treated
 * as an empty list so the UI degrades gracefully if localStorage is unavailable.
 */

const STORAGE_KEY = 'al-yo-bo:recent-queries';
const MAX_RECENT = 8;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function getRecentQueries(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentQuery(query: string): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const trimmed = query.trim();
  if (!trimmed) {
    return getRecentQueries();
  }
  const next = [trimmed, ...getRecentQueries().filter((q) => q !== trimmed)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be disabled or full; the palette still works without persistence.
  }
  return next;
}

export function removeRecentQuery(query: string): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const next = getRecentQueries().filter((q) => q !== query);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore persistence failures.
  }
  return next;
}
