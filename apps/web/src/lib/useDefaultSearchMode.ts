import { useCallback, useState } from 'react';

import type { SearchMode } from '@al-yo-bo/shared';

import { createSafeStorage } from '@/lib/storage';

const STORAGE_KEY = 'al-yo-bo:search-mode';

/** localStorage with an in-memory fallback for sandboxed/private-mode contexts. */
const storage = createSafeStorage('al-yo-bo:probe');

export function useDefaultSearchMode(): [SearchMode, (mode: SearchMode) => void] {
  const [mode, setModeState] = useState<SearchMode>(() => {
    const stored = storage.get(STORAGE_KEY);
    return stored === 'keyword' || stored === 'semantic' || stored === 'hybrid' ? stored : 'keyword';
  });

  const setMode = useCallback((next: SearchMode) => {
    storage.set(STORAGE_KEY, next);
    setModeState(next);
  }, []);

  return [mode, setMode];
}
