/**
 * Browser-safe UUID codec (ARCHITECTURE §4): `shared` holds no Bun-specific
 * runtime, so this module must stay free of `Bun.*`. UUIDv7 identifiers are
 * stored as 16-byte BLOBs in SQLite (the schema enforces `typeof(id) = 'blob'
 * AND length(id) = 16`), but exposed as canonical UUID strings at the API edge.
 * These helpers only convert between the two; generation lives in
 * `@al-yo-bo/db` (`newId`/`newIdBytes`), next to the writes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error(`Expected 16 bytes, got ${bytes.length}`);
  }
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidToBytes(uuid: string): Uint8Array {
  if (!isUuid(uuid)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
