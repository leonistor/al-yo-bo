import { useCallback, useState } from 'react';

import { createSafeStorage } from '@/lib/storage';

export type Layout = 'list' | 'grid' | 'dense';

const STORAGE_KEY = 'al-yo-bo:layout';

/** localStorage with an in-memory fallback for sandboxed/private-mode contexts. */
const storage = createSafeStorage('al-yo-bo:probe');

function parseLayout(value: string | null): Layout {
  return value === 'grid' || value === 'dense' ? value : 'list';
}

export function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setLayoutState] = useState<Layout>(() => parseLayout(storage.get(STORAGE_KEY)));

  const setLayout = useCallback((next: Layout) => {
    storage.set(STORAGE_KEY, next);
    setLayoutState(next);
  }, []);

  return [layout, setLayout];
}