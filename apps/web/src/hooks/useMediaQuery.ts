import { useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query. SSR-safe and reactive: components re-render
 * when the viewport crosses the breakpoint (media query change events are the
 * store; getSnapshot returns the current boolean).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
