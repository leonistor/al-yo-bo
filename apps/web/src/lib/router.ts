import { useEffect, useState } from 'react';

/**
 * Minimal hash router — two routes, no dependency.
 * `#/` (or no hash) is the library shell; `#/import` is the import page.
 * The review queue stays an in-app view under the library route.
 */
export type Route = 'library' | 'import';

function parseHash(hash: string): Route {
  return hash.replace(/^#\/?/, '') === 'import' ? 'import' : 'library';
}

export function getRoute(): Route {
  return parseHash(window.location.hash);
}

export function navigate(route: Route): void {
  window.location.hash = route === 'import' ? '/import' : '/';
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
