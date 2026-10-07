/**
 * Scenario 01 — navigation smoke (the harness validation scenario).
 *
 * Covers: sidebar navigation to every route, direct hash navigation,
 * keyboard shortcuts (palette, sidebar toggle, "/" search focus) and the
 * mobile off-canvas nav sheet. Function only — no layout or styling.
 */
// Cache-busted imports: the playwriter relay daemon caches imported modules
// across executions, so every run must bust the module registry with a unique
// query to pick up helper edits.
const { beginScenario, check, assertEqual, finish } = await import(
  `./e2e/helpers/assert.mjs?v=${Date.now()}`
);
const { openApp, attachErrorCollector, navButton, BASE_URL } = await import(
  `./e2e/helpers/env.mjs?v=${Date.now()}`
);

// Default list sort is created_at desc with 20 per page: "Google Fonts" is the
// newest seeded bookmark and always on page 1; the oldest (GitHub) are not.
const FIRST_PAGE_TITLE = 'Google Fonts';

beginScenario('01-nav');

// Playwriter globals (state/context) exist only in scenario top-level code.
if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;
const errors = attachErrorCollector(page);

await openApp(page);

const hash = () => new URL(page.url()).hash;

await check('library lists seeded bookmarks', async () => {
  await page.getByText(FIRST_PAGE_TITLE).first().waitFor({ state: 'visible', timeout: 15_000 });
});

const routes = [
  { label: 'Import', hash: '#/import', marker: () => page.getByRole('tab', { name: 'Paste text' }) },
  { label: 'Export', hash: '#/export', marker: () => page.getByRole('heading', { name: 'Export', exact: true }) },
  { label: 'Vocabulary', hash: '#/vocabulary', marker: () => page.getByRole('heading', { name: 'Vocabulary', exact: true }) },
  { label: 'Share', hash: '#/share', marker: () => page.getByRole('heading', { name: 'Share', exact: true }) },
];
for (const route of routes) {
  await check(`sidebar "${route.label}" navigates to ${route.hash}`, async () => {
    await navButton(page, route.label).click();
    await route.marker().waitFor({ state: 'visible', timeout: 10_000 });
    assertEqual(hash(), route.hash, `hash after clicking ${route.label}`);
  });
}

await check('account menu navigates to profile', async () => {
  await page.getByRole('button', { name: 'Profile & settings' }).click();
  await page
    .getByRole('heading', { name: 'Profile & settings', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  assertEqual(hash(), '#/profile', 'hash after profile click');
});

// "All bookmarks" is the home action: it resets category/tag filters AND
// navigates back to the library from any route (no-op hash change at home).
await check('"All bookmarks" navigates home from another route', async () => {
  await navButton(page, 'All bookmarks').click();
  await page.getByText(FIRST_PAGE_TITLE).first().waitFor({ state: 'visible', timeout: 10_000 });
  assertEqual(hash(), '#/', 'hash after All bookmarks on profile');
});

// History after the home navigation: [..., #/share, #/profile, #/] — one back
// step lands on the profile route the user came from.
await check('browser back returns to the previous route', async () => {
  await page.goBack();
  await page
    .getByRole('heading', { name: 'Profile & settings', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  assertEqual(hash(), '#/profile', 'hash after browser back');
});

await check('direct hash navigation renders vocabulary', async () => {
  await page.goto(`${BASE_URL}/#/vocabulary`);
  await page
    .getByRole('heading', { name: 'Vocabulary', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
});

await openApp(page);

await check('Cmd/Ctrl+K opens and Escape closes the command palette', async () => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 });
});

await check('slash focuses search', async () => {
  await page.keyboard.press('/');
  const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  assertEqual(label, 'Search bookmarks', 'focused element after "/"');
});

await check('Cmd/Ctrl+B collapses and expands the sidebar', async () => {
  await page.keyboard.press('ControlOrMeta+b');
  await page.getByRole('button', { name: 'Expand sidebar' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.press('ControlOrMeta+b');
  await page.getByRole('button', { name: 'All bookmarks' }).waitFor({ state: 'visible', timeout: 5000 });
});

await check('mobile off-canvas navigation works', async () => {
  await page.setViewportSize({ width: 375, height: 720 });
  const openNav = page.getByRole('button', { name: 'Open navigation' });
  await openNav.waitFor({ state: 'visible', timeout: 5000 });
  await openNav.click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Export', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  assertEqual(hash(), '#/export', 'hash after mobile nav');
  await page.locator('[data-slot="sheet-popup"]').waitFor({ state: 'hidden', timeout: 5000 });
  await page.setViewportSize({ width: 1280, height: 800 });
});

const { pageErrors, consoleErrors } = errors.drain();
await check('no uncaught page errors', () => {
  if (consoleErrors.length > 0) {
    console.log(`E2E_INFO console errors (informational): ${consoleErrors.join(' | ')}`);
  }
  assertEqual(pageErrors.length, 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
});

await finish();
