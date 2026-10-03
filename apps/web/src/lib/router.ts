import { useEffect, useState } from 'react';

/**
 * Minimal hash router — four routes, no dependency.
 * `#/` (or no hash) is the library shell; `#/import`, `#/vocabulary`, and `#/share`
 * are in-shell pages. The review queue stays an in-app view under the library route.
 */
export type Route = 'library' | 'import' | 'vocabulary' | 'share';

const ROUTES: Route[] = ['library', 'import', 'vocabulary', 'share'];

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
