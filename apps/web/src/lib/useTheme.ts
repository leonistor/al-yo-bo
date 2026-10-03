import { useCallback, useEffect, useState } from 'react';

import { createSafeStorage } from '@/lib/storage';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'al-yo-bo:theme';

/** localStorage with an in-memory fallback for sandboxed/private-mode contexts. */
const storage = createSafeStorage('al-yo-bo:probe');

export function resolved(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') {
    return theme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', resolved(theme) === 'dark');
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = storage.get(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  });

  useEffect(() => {
    apply(theme);
    if (theme !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => apply('system');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    storage.set(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return [theme, setTheme];
}