/**
 * Server-side UUIDv7 generation (ARCHITECTURE §4).
 *
 * `@al-yo-bo/shared` stays browser-safe, so the `Bun.randomUUIDv7` calls live
 * here in `db` — the layer that actually writes rows and therefore the place
 * that mints their primary keys. The pure string/byte codec remains exported
 * from `@al-yo-bo/shared` (`uuidToBytes`/`bytesToUuid`/`isUuid`).
 */

/** Generates a v7 UUID as the 16-byte BLOB representation used as a primary key. */
export function newIdBytes(): Uint8Array {
  return Bun.randomUUIDv7('buffer');
}

export function newId(): string {
  return Bun.randomUUIDv7();
}
