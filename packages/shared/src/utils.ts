export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Canonical upsert key: lowercased host, no trailing slash, no fragment. */
export function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname === '/') {
    url.pathname = '';
  }
  return url.toString();
}

export function clampPagination(limit?: number, offset?: number): { limit: number; offset: number } {
  const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.trunc(limit as number))) : 20;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset as number)) : 0;
  return { limit: safeLimit, offset: safeOffset };
}

/**
 * Turns a user query into a safe FTS5 MATCH expression: every whitespace-separated
 * token is quoted, so FTS operators typed by the user are treated literally.
 */
export function toFtsMatch(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`);
  return tokens.join(' ');
}

export function msFromIso(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Date.now();
}
