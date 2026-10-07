/**
 * Scenario 03 — bookmark CRUD: add via the topbar sheet, edit + tag-assign in
 * the detail sheet, then delete via the list row's confirm dialog (cancel and
 * confirm paths).
 *
 * Uses a per-run unique title and URL: the scratch env persists across re-runs
 * within a suite session and bookmarks upsert by URL, so a fixed identity
 * would collide with leftovers from a previous run.
 *
 * Selector note: BookmarkListCrossfade keeps two list slots in the DOM and
 * aria-hides the inactive one — list queries must go through the role-based
 * bookmarks list (getByRole skips aria-hidden subtrees) or be scoped to it.
 */
const { beginScenario, check, assertEqual, finish } = await import(
  `./e2e/helpers/assert.mjs?v=${Date.now()}`
);
const { openApp, attachErrorCollector } = await import(`./e2e/helpers/env.mjs?v=${Date.now()}`);

const unique = `E2E CRUD ${Date.now()}`;
const edited = `${unique} edited`;
const url = `https://example.com/e2e-crud-${Date.now()}`;

beginScenario('03-bookmarks-crud');

// Playwriter globals (state/context) exist only in scenario top-level code.
if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;
const errors = attachErrorCollector(page);

const bookmarksList = () => page.getByRole('list', { name: 'Bookmarks' });
const sheet = () => page.locator('[data-slot="sheet-popup"]');
const alertDialog = () => page.locator('[data-slot="alert-dialog-popup"]');
/** Title button of the given bookmark, scoped to the active crossfade slot. */
const titleButtonFor = (title) =>
  bookmarksList().locator('[data-title-button]', { hasText: title });
/** The <li> card containing a given bookmark title, scoped to the active slot. */
const cardFor = (title) =>
  bookmarksList().locator('li[data-bookmark-id]', {
    has: page.locator('[data-title-button]', { hasText: title }),
  });

await openApp(page);

await check('adding a bookmark shows it in the library', async () => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await sheet().waitFor({ state: 'visible', timeout: 10_000 });
  await sheet().locator('#add-url').fill(url);
  await sheet().locator('#add-title').fill(unique);
  await sheet().locator('#add-description').fill('e2e scratch bookmark');
  await sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Bookmark saved').waitFor({ state: 'visible', timeout: 15_000 });
  await sheet().waitFor({ state: 'hidden', timeout: 10_000 });
  // created_at is server-set, so the new bookmark sorts first on page 1.
  await bookmarksList().getByText(unique).waitFor({ state: 'visible', timeout: 15_000 });
});

await check('the new bookmark opens in the detail sheet', async () => {
  await titleButtonFor(unique).click();
  await sheet().waitFor({ state: 'visible', timeout: 10_000 });
  await sheet().getByText(unique).first().waitFor({ state: 'visible', timeout: 10_000 });
  // Leave the sheet open: the next check edits it in place.
});

await check('editing the title persists to the list', async () => {
  await sheet().locator('#detail-title').fill(edited);
  await sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Bookmark updated').waitFor({ state: 'visible', timeout: 15_000 });
  // Escape closes the detail sheet (App-level handler); the footer "Close"
  // would collide with the corner X button, which has the same accessible name.
  await page.keyboard.press('Escape');
  await sheet().waitFor({ state: 'hidden', timeout: 10_000 });
  await bookmarksList().getByText(edited).waitFor({ state: 'visible', timeout: 15_000 });
});

await check('assigning an existing tag shows it on the card', async () => {
  await titleButtonFor(edited).click();
  await sheet().waitFor({ state: 'visible', timeout: 10_000 });
  await sheet().locator('#detail-add-tag').click();
  const popover = page.locator('[data-slot="popover-content"]');
  await popover.waitFor({ state: 'visible', timeout: 10_000 });
  // Placeholder (with U+2026) instead of the aria-label — the input's
  // accessible-name plumbing didn't expose it to getByLabel.
  await popover.getByPlaceholder('Search tags…').fill('tooling');
  // "tooling" exists in the seed, so the only item is the existing tag (no Create row).
  await popover.getByText('tooling', { exact: true }).click();
  await sheet().getByText('tooling').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  await sheet().waitFor({ state: 'hidden', timeout: 10_000 });
  await cardFor(edited).getByText('tooling').waitFor({ state: 'visible', timeout: 15_000 });
});

await check('canceling the delete keeps the bookmark', async () => {
  await bookmarksList().getByRole('button', { name: `Delete ${edited}` }).click();
  await alertDialog().waitFor({ state: 'visible', timeout: 10_000 });
  await alertDialog().getByText('Delete bookmark?').waitFor({ state: 'visible', timeout: 10_000 });
  await alertDialog().getByRole('button', { name: 'Cancel', exact: true }).click();
  await alertDialog().waitFor({ state: 'hidden', timeout: 10_000 });
  await cardFor(edited).getByText(edited).waitFor({ state: 'visible', timeout: 15_000 });
});

await check('confirming the delete removes the bookmark', async () => {
  await bookmarksList().getByRole('button', { name: `Delete ${edited}` }).click();
  await alertDialog().waitFor({ state: 'visible', timeout: 10_000 });
  await alertDialog().getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('Bookmark deleted').waitFor({ state: 'visible', timeout: 15_000 });
  await bookmarksList().getByText(edited).waitFor({ state: 'hidden', timeout: 15_000 });
});

const { pageErrors, consoleErrors } = errors.drain();
await check('no uncaught page errors', () => {
  if (consoleErrors.length > 0) {
    console.log(`E2E_INFO console errors (informational): ${consoleErrors.join(' | ')}`);
  }
  assertEqual(pageErrors.length, 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
});

await finish();
