/**
 * Scenario 07 — profile & settings: layout/theme/default-search-mode
 * preferences persist via localStorage across full reloads, plus the identity
 * rename round trip (server-persisted profile, surfaced in the sidebar avatar).
 *
 * Every preference is reset to its default afterwards so later scenarios — and
 * later suite runs sharing this browser profile — see the stock state
 * (useTheme default 'system', useDefaultSearchMode default 'keyword',
 * useLayout default 'list', seeded name 'octocat').
 */
const { beginScenario, check, assert, assertEqual, finish } = await import(
  `./e2e/helpers/assert.mjs?v=${Date.now()}`
);
const { openApp, attachErrorCollector, sidebar } = await import(
  `./e2e/helpers/env.mjs?v=${Date.now()}`
);

/** The Preferences card; the topbar hosts same-named controls, so scope here. */
const preferences = (page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'Preferences', exact: true }) });
/** The live topbar search-mode group (fieldset aria-label), on every route. */
const topbarMode = (page) => page.locator('fieldset[aria-label="Search mode"]');

async function assertPressed(locator, label) {
  assertEqual(await locator.getAttribute('aria-pressed'), 'true', `${label} aria-pressed`);
}

/**
 * Poll `html.dark` via round-trip evaluates — page.waitForFunction does not
 * evaluate reliably through the playwriter relay (predicate times out).
 */
async function waitForDark(page, expected, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (dark === expected) {
      return;
    }
    assert(Date.now() <= deadline, `html.dark is ${dark}, expected ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

beginScenario('07-profile');

if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;
const errors = attachErrorCollector(page);

await openApp(page, 'profile');

await check('profile page renders all sections', async () => {
  await page
    .getByRole('heading', { name: 'Profile & settings', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  for (const section of ['Identity', 'Preferences', 'Workspace', 'System status']) {
    await page
      .getByRole('heading', { name: section, exact: true })
      .waitFor({ state: 'visible' });
  }
});

await check('layout preference persists across a full reload', async () => {
  await preferences(page).getByRole('button', { name: 'Grid' }).click();
  await assertPressed(preferences(page).getByRole('button', { name: 'Grid' }), 'Grid (profile)');
  // A full reload remounts the app, so surviving state is genuinely persisted.
  await openApp(page, 'library');
  await assertPressed(page.getByRole('button', { name: 'Grid view', exact: true }), 'Grid (library toolbar)');
  await openApp(page, 'profile');
  await assertPressed(preferences(page).getByRole('button', { name: 'Grid' }), 'Grid after reload');
  // Reset to the default; this state lives in localStorage and would otherwise
  // leak into later scenarios/runs of this browser profile.
  await preferences(page).getByRole('button', { name: 'List' }).click();
  await assertPressed(preferences(page).getByRole('button', { name: 'List' }), 'List after reset');
});

await check('theme preference toggles html.dark and resets to system', async () => {
  await preferences(page).getByRole('button', { name: 'Dark' }).click();
  await waitForDark(page, true);
  await preferences(page).getByRole('button', { name: 'System' }).click();
  // "System" resolves from the media query: compare against it rather than
  // assuming light (headless Chrome follows the host's system appearance).
  const mediaDark = await page.evaluate(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  await waitForDark(page, mediaDark);
});

await check('default search mode applies after reload and resets', async () => {
  await preferences(page).getByRole('button', { name: 'Hybrid' }).click();
  await assertPressed(preferences(page).getByRole('button', { name: 'Hybrid' }), 'Hybrid (profile)');
  // The toolbar mode starts from the persisted default only after a remount.
  await openApp(page, 'library');
  await assertPressed(topbarMode(page).getByRole('button', { name: 'Hybrid' }), 'Hybrid (topbar)');
  await openApp(page, 'profile');
  await preferences(page).getByRole('button', { name: 'Keyword' }).click();
  await assertPressed(preferences(page).getByRole('button', { name: 'Keyword' }), 'Keyword (reset)');
  await openApp(page, 'library');
  await assertPressed(topbarMode(page).getByRole('button', { name: 'Keyword' }), 'Keyword (topbar)');
});

await check('identity rename round trip updates the sidebar avatar', async () => {
  await openApp(page, 'profile');
  const identity = page.locator('section', {
    has: page.getByRole('heading', { name: 'Identity', exact: true }),
  });
  await identity
    .getByRole('button', { name: 'octocat', exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });

  // Name is the first inline-editable field (GitHub username carries the same
  // seeded value, hence .first()); Enter commits the edit server-side.
  await identity.getByRole('button', { name: 'octocat', exact: true }).first().click();
  await identity.getByPlaceholder('Add your name').fill('octocat e2e');
  await identity.getByPlaceholder('Add your name').press('Enter');
  await identity
    .getByRole('button', { name: 'octocat e2e', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  // The sidebar avatar renders initials from the name: "octocat e2e" → "OE".
  await sidebar(page)
    .getByText('OE', { exact: true })
    .waitFor({ state: 'visible', timeout: 5000 });

  await identity.getByRole('button', { name: 'octocat e2e', exact: true }).first().click();
  await identity.getByPlaceholder('Add your name').fill('octocat');
  await identity.getByPlaceholder('Add your name').press('Enter');
  await identity
    .getByRole('button', { name: 'octocat', exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  // Single-word names get a single initial ("octocat" → "O").
  await sidebar(page)
    .getByText('O', { exact: true })
    .waitFor({ state: 'visible', timeout: 5000 });
});

const { pageErrors, consoleErrors } = errors.drain();
await check('no uncaught page errors', () => {
  if (consoleErrors.length > 0) {
    console.log(`E2E_INFO console errors (informational): ${consoleErrors.join(' | ')}`);
  }
  assertEqual(pageErrors.length, 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
});

await finish();
