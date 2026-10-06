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

/**
 * Codec for embedding BLOBs: little-endian Float32 arrays as stored in the
 * `bookmark_embeddings.embedding` column (MODEL.md). Shared by `packages/search`
 * (in-memory matrix) and `packages/vectordb` (Qdrant points).
 */
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

/** Message for a failed fetch; timeout/abort aborts surface as timeouts. */
export function describeFetchFailure(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'request timed out';
  }
  return error instanceof Error ? error.message : String(error);
}
