/**
 * Scenario 05 — markdown import: paste → extract → edit → commit → re-import idempotency.
 *
 * The e2e env has no AI extraction configured, so the server's deterministic
 * markdown parser serves the preview. The fixture (e2e/fixtures/import-sample.md)
 * is namespaced ("E2E Fixture: …") and its URLs are unique to the fixture, so
 * upsert-by-URL counts are exact even when sibling scenarios added bookmarks.
 *
 * Parser note (packages/importer/parse.ts): the whole bullet note minus the URL
 * becomes BOTH title and description, so imported titles include the "— …" tail.
 */
const { beginScenario, check, assert, assertEqual, finish } = await import(
  `./e2e/helpers/assert.mjs?v=${Date.now()}`
);
const { openApp, attachErrorCollector } = await import(`./e2e/helpers/env.mjs?v=${Date.now()}`);
const fs = await import('node:fs/promises');

// Full titles as the parser produces them: bullet note with the URL stripped.
const TITLE_PLAYWRITER = 'E2E Fixture: Playwriter — Browser automation driving the e2e suite.';
const TITLE_BUN = 'E2E Fixture: Bun docs — All-in-one runtime used by the app under test.';
/** The row excluded in the partial commit, then added by the first re-import. */
const SQLITE_URL_TEXT = 'https://www.sqlite.org/docs.html';

const markdown = await fs.readFile('e2e/fixtures/import-sample.md', 'utf8');

beginScenario('05-import');

if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;
const errors = attachErrorCollector(page);

// Extracted rows live in an editable table; an included row is data-included="true".
// (page.getByDisplayValue is not exposed by the playwriter relay — read input
// values via evaluateAll instead.)
const extractedRows = () => page.locator('section[aria-label="Extracted bookmarks"] tbody tr');
const toast = (text) => page.getByText(text, { exact: true });
/** Current `value` of every input carrying `ariaLabel` on the page. */
async function inputValues(pageLike, ariaLabel) {
  return pageLike
    .getByLabel(ariaLabel, { exact: true })
    .evaluateAll((elements) => elements.map((element) => element.value));
}

await openApp(page, 'import');

await check('import page renders the paste tab and extract control', async () => {
  await page.getByRole('tab', { name: 'Paste text' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByLabel('Import text').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: 'Extract' }).waitFor({ state: 'visible' });
});

await check('extract previews all 3 fixture rows with category paths', async () => {
  await page.getByLabel('Import text').fill(markdown);
  await page.getByRole('button', { name: 'Extract' }).click();
  // The provider status line proves the deterministic parser served the preview.
  await page.getByText('Fallback: deterministic parser').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText('https://playwriter.dev', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  assertEqual(await extractedRows().count(), 3, 'extracted row count');
  const titles = await inputValues(page, 'Title');
  assert(titles.includes(TITLE_PLAYWRITER), `Playwriter title in rows: ${JSON.stringify(titles)}`);
  assert(titles.includes(TITLE_BUN), `Bun docs title in rows: ${JSON.stringify(titles)}`);
  // Child path renders both as the editable "/"-joined field and a "▸" breadcrumb.
  const paths = await inputValues(page, 'Category path');
  assert(paths.includes('E2E Testing'), `root path in rows: ${JSON.stringify(paths)}`);
  assert(paths.includes('E2E Testing / Sub level'), `child path in rows: ${JSON.stringify(paths)}`);
  assertEqual(await page.getByText('E2E Testing ▸ Sub level').count(), 1, 'child path breadcrumb');
});

await check('excluding one row then committing imports 2 new bookmarks', async () => {
  const sqliteRow = page
    .getByRole('row')
    .filter({ has: page.getByText(SQLITE_URL_TEXT) });
  await sqliteRow.getByRole('checkbox', { name: 'Exclude from import' }).click();
  // The label flips once the patch lands; this doubles as the excluded-state proof.
  await sqliteRow.getByRole('checkbox', { name: 'Include in import' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Import 2 bookmarks' }).click();
  await toast('Imported 2 new, 0 updated').waitFor({ state: 'visible', timeout: 10_000 });
});

await check('library lists the imported bookmarks', async () => {
  await openApp(page, 'library');
  await page.getByLabel('Search bookmarks').fill('playwriter');
  await page
    .getByText('E2E Fixture: Playwriter')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  // The excluded row must not exist anywhere in the library.
  assertEqual(await page.getByText('E2E Fixture: SQLite docs').count(), 0, 'excluded row absent');
  // "bun docs" matches only the fixture's Bun bookmark (the seeded "Bun" has no "docs").
  await page.getByLabel('Search bookmarks').fill('bun docs');
  await page
    .getByText('E2E Fixture: Bun docs')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
});

await check('re-import upserts by URL', async () => {
  // First re-import: the previously excluded row is new, the other two update.
  await openApp(page, 'import');
  await page.getByLabel('Import text').fill(markdown);
  await page.getByRole('button', { name: 'Extract' }).click();
  await page.getByText('https://playwriter.dev', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  assertEqual(await extractedRows().count(), 3, 'extracted row count (re-import)');
  await page.getByRole('button', { name: 'Import 3 bookmarks' }).click();
  await toast('Imported 1 new, 2 updated').waitFor({ state: 'visible', timeout: 10_000 });

  // Second re-import of identical rows: pure idempotency — nothing new.
  await openApp(page, 'import');
  await page.getByLabel('Import text').fill(markdown);
  await page.getByRole('button', { name: 'Extract' }).click();
  await page.getByText('https://playwriter.dev', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  assertEqual(await extractedRows().count(), 3, 'extracted row count (idempotent)');
  await page.getByRole('button', { name: 'Import 3 bookmarks' }).click();
  await toast('Imported 0 new, 3 updated').waitFor({ state: 'visible', timeout: 10_000 });
});

const { pageErrors, consoleErrors } = errors.drain();
await check('no uncaught page errors', () => {
  if (consoleErrors.length > 0) {
    console.log(`E2E_INFO console errors (informational): ${consoleErrors.join(' | ')}`);
  }
  assertEqual(pageErrors.length, 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
});

await finish();
