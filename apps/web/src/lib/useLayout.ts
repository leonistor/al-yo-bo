import { useCallback, useState } from 'react';

import { createSafeStorage } from '@/lib/storage';

export type Layout = 'list' | 'grid';

const STORAGE_KEY = 'al-yo-bo:layout';

/** localStorage with an in-memory fallback for sandboxed/private-mode contexts. */
const storage = createSafeStorage('al-yo-bo:probe');

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