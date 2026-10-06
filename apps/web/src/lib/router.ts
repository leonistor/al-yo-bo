import { useEffect, useState } from 'react';

/**
 * Minimal hash router — no dependency.
 * `#/` (or no hash) is the library shell; `#/import`, `#/export`, `#/vocabulary`, `#/share`, and
 * `#/profile` are in-shell pages.
 */
export type Route = 'library' | 'import' | 'export' | 'vocabulary' | 'share' | 'profile';

const ROUTES: Route[] = ['library', 'import', 'export', 'vocabulary', 'share', 'profile'];

function parseHash(hash: string): Route {
  const candidate = hash.replace(/^#\/?/, '');
  return ROUTES.find((route) => route === candidate) ?? 'library';
}

export function getRoute(): Route {
  return parseHash(window.location.hash);
}

export function navigate(route: Route): void {
  window.location.hash = route === 'library' ? '/' : `/${route}`;
}

/** Reactive route state; re-renders on `hashchange` (nav links, back/forward). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(getRoute);

  useEffect(() => {
    function onHashChange() {
      setRoute(getRoute());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
