/**
 * Scenario 02 — library browsing: keyword search, category/tag filters,
 * pagination, sort direction, and the detail sheet.
 *
 * Runs against the seeded octocat fixture: default sort is created_at desc
 * with 20 per page, so page 1 holds the 20 newest (Google Fonts … OpenRouter)
 * and the 5 oldest GitHub bookmarks sit on page 2. Count assertions stay
 * scoped to fixture-stable terms ('coolors') because scenarios running later
 * in the suite add bookmarks — global counts are not stable.
 *
 * Selector note: BookmarkListCrossfade keeps two list slots in the DOM and
 * aria-hides the inactive one, so every list assertion goes through role
 * queries (getByRole skips aria-hidden subtrees); plain text locators would
 * match the inactive slot's stale copy too.
 */
const { beginScenario, check, assert, assertEqual, finish } = await import(
  `./e2e/helpers/assert.mjs?v=${Date.now()}`
);
const { openApp, attachErrorCollector, navButton, sidebar } = await import(
  `./e2e/helpers/env.mjs?v=${Date.now()}`
);

// Titles quoted with double quotes: the GitHub seed title uses a straight apostrophe.
const NEWEST_TITLE = 'Google Fonts';
const OLDEST_TITLE = "GitHub: Let's build from here";

beginScenario('02-library-search');

// Playwriter globals (state/context) exist only in scenario top-level code.
if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;
const errors = attachErrorCollector(page);

const searchInput = () => page.getByLabel('Search bookmarks');
const bookmarksList = () => page.getByRole('list', { name: 'Bookmarks' });
/** Exact-name button role: matches only the card title button in the active list slot. */
const titleButton = (title) => page.getByRole('button', { name: title, exact: true });
const RANGE_TEXT = /^\d+–\d+ of \d+$/; // e.g. "1–20 of 25" (en dash)

await openApp(page);

await check('page 1 shows newest bookmarks with pagination range', async () => {
  await titleButton(NEWEST_TITLE).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText(RANGE_TEXT).first().waitFor({ state: 'visible', timeout: 10_000 });
  assert(
    await page.getByRole('button', { name: 'Previous', exact: true }).isDisabled(),
    'Previous should be disabled on page 1',
  );
  assert(
    await page.getByRole('button', { name: 'Next', exact: true }).isEnabled(),
    'Next should be enabled on page 1',
  );
});

await check('keyword search narrows to the matching bookmark', async () => {
  await searchInput().fill('coolors');
  // The query is debounced 300ms and the crossfade cache keeps the previous
  // list on screen until the filtered result arrives — the removal of
  // "Google Fonts" is the fresh-data marker.
  await titleButton(NEWEST_TITLE).waitFor({ state: 'hidden', timeout: 15_000 });
  await titleButton('Coolors').waitFor({ state: 'visible', timeout: 10_000 });
  // The toolbar's aria-live span shows "1 result" (with "· updating…" while fetching).
  await page.waitForFunction(() => {
    const el = document.querySelector('main [aria-live="polite"]');
    return el?.textContent === '1 result';
  });
});

await check('a non-matching search shows the filtered empty state', async () => {
  await searchInput().fill('zzznope');
  // The empty state renders in both crossfade slots; the clear action is
  // role-addressable and unique to the active slot, so it marks the state.
  await page
    .getByRole('button', { name: 'Clear search & filters' })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText('No matching bookmarks').first().waitFor({ state: 'visible' });
});

await check('Clear search & filters restores the full list', async () => {
  await page.getByRole('button', { name: 'Clear search & filters' }).click();
  await titleButton(NEWEST_TITLE).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText(RANGE_TEXT).first().waitFor({ state: 'visible', timeout: 10_000 });
});

await check('Design category filter limits the list to that category', async () => {
  // Category rows are scoped by data-category-id so the "design" tag pill (also a
  // button whose name contains "design") cannot match.
  await sidebar(page)
    .locator('[data-category-id]')
    .getByRole('button', { name: 'Design' })
    .click();
  // ChatGPT (AI tools) was on page 1 unfiltered; its removal marks the
  // filtered response having landed.
  await titleButton('ChatGPT').waitFor({ state: 'hidden', timeout: 15_000 });
  await titleButton(NEWEST_TITLE).waitFor({ state: 'visible', timeout: 10_000 });
  await titleButton('Coolors').waitFor({ state: 'visible', timeout: 10_000 });
});

await check('design tag filter limits the list to tagged bookmarks', async () => {
  await navButton(page, 'All bookmarks').click();
  await titleButton('Bun').waitFor({ state: 'visible', timeout: 15_000 });
  // The sidebar tag cloud is limited to the top-14 A–Z tags, which 'design' is
  // past; the same tag filter is reachable via a card's tag pill.
  const fontsCard = bookmarksList().locator('li[data-bookmark-id]', {
    has: titleButton(NEWEST_TITLE),
  });
  await fontsCard.getByRole('button', { name: 'design', exact: true }).click();
  await titleButton('Bun').waitFor({ state: 'hidden', timeout: 15_000 });
  await titleButton(NEWEST_TITLE).waitFor({ state: 'visible', timeout: 10_000 });
});

await check('Next/Previous move between pages', async () => {
  await navButton(page, 'All bookmarks').click();
  await titleButton('Bun').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await titleButton(OLDEST_TITLE).waitFor({ state: 'visible', timeout: 15_000 });
  assert(
    await page.getByRole('button', { name: 'Previous', exact: true }).isEnabled(),
    'Previous should be enabled on page 2',
  );
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await titleButton(OLDEST_TITLE).waitFor({ state: 'hidden', timeout: 15_000 });
  await titleButton(NEWEST_TITLE).waitFor({ state: 'visible', timeout: 10_000 });
});

await check('sorting Oldest first puts the oldest bookmark first', async () => {
  const firstItem = bookmarksList().locator('li').first();
  await page.getByLabel('Sort by').click();
  await page.getByRole('option', { name: 'Oldest first' }).click();
  await firstItem.getByText(OLDEST_TITLE).waitFor({ state: 'visible', timeout: 15_000 });
  // Restore the default so later scenarios see the standard order.
  await page.getByLabel('Sort by').click();
  await page.getByRole('option', { name: 'Newest first' }).click();
  await firstItem.getByText(NEWEST_TITLE).waitFor({ state: 'visible', timeout: 15_000 });
});

await check('a card opens the detail sheet and Escape closes it', async () => {
  await titleButton(NEWEST_TITLE).click();
  const sheet = page.locator('[data-slot="sheet-popup"]');
  await sheet.waitFor({ state: 'visible', timeout: 10_000 });
  await sheet.getByText(NEWEST_TITLE).first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden', timeout: 10_000 });
});

const { pageErrors, consoleErrors } = errors.drain();
await check('no uncaught page errors', () => {
  if (consoleErrors.length > 0) {
    console.log(`E2E_INFO console errors (informational): ${consoleErrors.join(' | ')}`);
  }
  assertEqual(pageErrors.length, 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
});

await finish();
