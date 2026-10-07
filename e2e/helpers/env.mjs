/**
 * Shared page helpers for e2e scenarios.
 *
 * Helpers deliberately use only Playwright page/locator APIs: the
 * Playwriter-injected globals (`state`, `context`, `snapshot`,
 * `getLatestLogs`, `waitForPageLoad`) are not visible inside imported
 * modules, so they may only be used from scenario top-level code.
 */

export const BASE_URL = 'http://127.0.0.1:5173';

/** Hash routes (apps/web/src/lib/router.ts) — the app has no path-based URLs. */
export const ROUTE_HASH = {
  library: '#/',
  import: '#/import',
  export: '#/export',
  vocabulary: '#/vocabulary',
  share: '#/share',
  profile: '#/profile',
};

const SEARCH_INPUT_LABEL = 'Search bookmarks';
const READY_TIMEOUT = 30_000;

/**
 * Load the app on `route` (desktop viewport) and wait for the shell.
 *
 * The topbar search input is the readiness marker: it renders only after the
 * profile query resolved and setup is complete. If it never appears, the most
 * likely cause is the setup-wizard gate (App.tsx renders SetupPage instead of
 * the shell when `setupCompletedAt === null`) — i.e. the scratch env was not
 * seeded.
 */
export async function openApp(page, route = 'library') {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Force a fresh document first: a goto that only changes the hash is a
  // same-document navigation, which would keep React state (filters,
  // selections, page number) alive across scenarios and leak one scenario's
  // setup into the next.
  await page.goto('about:blank');
  await page.goto(`${BASE_URL}/${ROUTE_HASH[route]}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.getByLabel(SEARCH_INPUT_LABEL).waitFor({ state: 'visible', timeout: READY_TIMEOUT });
  } catch {
    throw new Error(
      'App shell never appeared — is the setup wizard gating the UI? The e2e env must be seeded (db:seed sets setupCompletedAt) before scenarios run.',
    );
  }
  return page;
}

/** Same-document navigation via hash; fires the app's `hashchange` router. */
export async function gotoRoute(page, route) {
  await page.goto(`${BASE_URL}/${ROUTE_HASH[route]}`);
}

/** The persistent sidebar is the first <aside> in the DOM (the chat aside, if any, renders later). */
export function sidebar(page) {
  return page.locator('aside').first();
}

/** Button inside the sidebar by accessible name (substring match, like getByRole default). */
export function navButton(page, name) {
  return sidebar(page).getByRole('button', { name });
}

/**
 * Collect uncaught page errors and console errors for end-of-scenario gating.
 * Uncaught errors fail the scenario; console.error entries are reported but
 * informational only — dev-mode noise (network retries, extension chatter)
 * would otherwise flake the suite.
 */
export function attachErrorCollector(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const onPageError = (error) => pageErrors.push(String(error?.message ?? error));
  const onConsole = (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  return {
    drain() {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
      return { pageErrors, consoleErrors };
    },
  };
}
