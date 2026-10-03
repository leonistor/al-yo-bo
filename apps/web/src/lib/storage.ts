export interface SafeStorage {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}

/**
 * Creates a key/value store backed by `localStorage` when available, falling
 * back to an in-memory Map when localStorage is inaccessible (sandboxed
 * iframes, private modes, quota errors). The probe key is removed after the
 * test so callers can safely use the returned object for the lifetime of the
 * session.
 */
export function createSafeStorage(probeKey: string): SafeStorage {
  const memory = new Map<string, string>();
  try {
    localStorage.setItem(probeKey, probeKey);
    localStorage.removeItem(probeKey);
    return {
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
    };
  } catch {
    return {
      get: (key) => memory.get(key) ?? null,
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}
