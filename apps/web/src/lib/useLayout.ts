import { useCallback, useState } from 'react';

export type Layout = 'list' | 'grid';

const STORAGE_KEY = 'al-yo-bo:layout';

export function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setLayoutState] = useState<Layout>(() =>
    localStorage.getItem(STORAGE_KEY) === 'grid' ? 'grid' : 'list',
  );

  const setLayout = useCallback((next: Layout) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLayoutState(next);
  }, []);

  return [layout, setLayout];
}
