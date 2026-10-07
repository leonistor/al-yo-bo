/**
 * Scenario 06 — bookmark export: format selection, filters, live match count
 * and verified file downloads (filtered JSON + Netscape HTML).
 *
 * The filtered term 'coolors' matches only the seeded Coolors bookmark, so the
 * filtered match count is exactly 1 regardless of what other scenarios added.
 * Downloads are captured with page.waitForEvent('download') and saved under
 * /tmp (the only writable location for scenario top-level fs access).
 */
const { beginScenario, check, assert, assertEqual, finish } = await import(
  `./e2e/helpers/assert.mjs?v=${Date.now()}`
);
const { openApp, attachErrorCollector } = await import(`./e2e/helpers/env.mjs?v=${Date.now()}`);
const fs = await import('node:fs/promises');

const JSON_PATH = '/tmp/al-yo-bo-e2e-export.json';
const HTML_PATH = '/tmp/al-yo-bo-e2e-export.html';
// Live count copy: "<N> bookmark matches" (singular) / "<N> bookmarks match".
const MATCH_COUNT_RE = /(\d+) bookmarks? match/;

/** Click the export button and save the triggered download to `target`. */
async function downloadExport(page, buttonName, target) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
  await download.saveAs(target);
}

beginScenario('06-export');

if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;
const errors = attachErrorCollector(page);

await openApp(page, 'export');

await check('export page renders formats, filters and a match count > 0', async () => {
  await page.getByRole('heading', { name: 'Export', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('heading', { name: 'Formats' }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Filters' }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Preview' }).waitFor({ state: 'visible' });
  // HTML is checked by default; the CSV/Markdown options are offered.
  for (const format of ['HTML', 'JSON', 'CSV', 'Markdown']) {
    await page.getByRole('checkbox', { name: format, exact: true }).waitFor({ state: 'visible' });
  }
  // Never assert the exact total — sibling scenarios may have added bookmarks.
  await page.getByText(MATCH_COUNT_RE).waitFor({ state: 'visible', timeout: 15_000 });
  const text = await page.getByText(MATCH_COUNT_RE).innerText();
  const total = Number(MATCH_COUNT_RE.exec(text)?.[1] ?? 0);
  assert(total > 0, `default match count must be > 0, got: ${text}`);
});

await check('selecting JSON shows the zip hint', async () => {
  await page.getByRole('checkbox', { name: 'JSON', exact: true }).click();
  await page
    .getByText('Multiple formats download as a single .zip')
    .waitFor({ state: 'visible', timeout: 5000 });
});

await check('search filter narrows the match count to 1', async () => {
  await page.locator('#export-q').fill('coolors');
  await page.getByText('1 bookmark matches').waitFor({ state: 'visible', timeout: 15_000 });
});

await check('JSON download contains the filtered bookmark', async () => {
  // A single selected format downloads the plain file (a second format → .zip).
  await page.getByRole('checkbox', { name: 'HTML', exact: true }).click();
  await page
    .getByText('Multiple formats download as a single .zip')
    .waitFor({ state: 'hidden', timeout: 5000 });
  await downloadExport(page, 'Export 1 bookmark', JSON_PATH);

  const content = await fs.readFile(JSON_PATH, 'utf8');
  const parsed = JSON.parse(content);
  assertEqual(parsed.format, 'al-yo-bo/export', 'JSON format marker');
  assert(Array.isArray(parsed.bookmarks), 'JSON has a bookmarks array');
  assertEqual(parsed.bookmarks.length, 1, 'filtered JSON bookmark count');
  const title = parsed.bookmarks[0]?.title ?? '';
  assert(title.includes('Coolors'), `JSON bookmark title should mention Coolors, got: ${title}`);
});

await check('HTML download is a Netscape file with the bookmark', async () => {
  await page.getByRole('checkbox', { name: 'HTML', exact: true }).click();
  await page.getByRole('checkbox', { name: 'JSON', exact: true }).click();
  await downloadExport(page, 'Export 1 bookmark', HTML_PATH);

  const content = await fs.readFile(HTML_PATH, 'utf8');
  assert(
    content.includes('<!DOCTYPE NETSCAPE-Bookmark-file'),
    'HTML export must carry the Netscape DOCTYPE marker',
  );
  assert(content.includes('Coolors'), 'HTML export must include the bookmark title');
});

const { pageErrors, consoleErrors } = errors.drain();
await check('no uncaught page errors', () => {
  if (consoleErrors.length > 0) {
    console.log(`E2E_INFO console errors (informational): ${consoleErrors.join(' | ')}`);
  }
  assertEqual(pageErrors.length, 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
});

await finish();
