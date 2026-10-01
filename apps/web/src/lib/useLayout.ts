import { useCallback, useState } from 'react';

export type Layout = 'list' | 'grid';

const STORAGE_KEY = 'al-yo-bo:layout';

/**
 * localStorage can throw (sandboxed iframes, privacy modes, quota) — degrade to
 * an in-memory fallback instead of crashing the app at mount.
 */
const storage = (() => {
  const memory = new Map<string, string>();
  try {
    const probe = 'al-yo-bo:probe';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return {
      get: (key: string) => localStorage.getItem(key),
      set: (key: string, value: string) => localStorage.setItem(key, value),
    };
  } catch {
    return {
      get: (key: string) => memory.get(key) ?? null,
      set: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
  }
})();

export function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setLayoutState] = useState<Layout>(() =>
    storage.get(STORAGE_KEY) === 'grid' ? 'grid' : 'list',
  );

  const setLayout = useCallback((next: Layout) => {
    storage.set(STORAGE_KEY, next);
    setLayoutState(next);
  }, []);

  return [layout, setLayout];
}