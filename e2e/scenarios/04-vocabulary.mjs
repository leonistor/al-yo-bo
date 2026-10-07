/**
 * Scenario 04 — vocabulary management.
 *
 * Covers the Vocabulary page: seeded tags/categories render, and the full
 * tag lifecycle (create, rename, deprecate/reactivate, delete with confirm)
 * plus root-category create/delete. Tag rows expose deprecate directly and
 * edit/delete through the row's "More actions" overflow menu; category rows
 * expose add-child/edit directly and delete via the overflow menu.
 */
// Cache-busted imports: the playwriter relay daemon caches imported modules
// across executions, so every run must bust the module registry with a unique
// query to pick up helper edits.
const { beginScenario, check, assert, finish } = await import(
  `./e2e/helpers/assert.mjs?v=${Date.now()}`
);
const { openApp, attachErrorCollector } = await import(
  `./e2e/helpers/env.mjs?v=${Date.now()}`
);

// The DB persists across re-runs within a suite session, so every entity this
// scenario creates carries a per-run suffix (other lanes' fixtures do too).
const ts = Date.now();
const tagName = `e2e-tag-${ts}`;
const tagRenamed = `e2e-tag-r-${ts}`;
const catName = `E2E Category ${ts}`;

beginScenario('04-vocabulary');

// Playwriter globals (state/context) exist only in scenario top-level code.
if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;
const errors = attachErrorCollector(page);

await openApp(page, 'vocabulary');

// Scope every lookup to the active tab panel: the two panels share control
// labels ("Create", "Filter by name…"), and only one is mounted at a time.
const panel = () => page.getByRole('tabpanel');
const tagList = () => panel().getByRole('list', { name: 'Tags' });
const catTree = () => panel().locator('[aria-label="Categories"]');

/** The tags-tab row containing `name`. */
const tagRow = (name) => tagList().getByRole('listitem').filter({ hasText: name });

/**
 * Open a row's overflow menu and pick one item by name.
 *
 * Row action buttons are hover/focus-revealed (`pointer-events-none` until
 * the row's group-hover applies); hover the row explicitly or the headless
 * click hit-test keeps reporting the actions wrapper as intercepting.
 */
async function overflowAction(row, itemName) {
  await row.hover();
  await row.getByRole('button', { name: 'More actions' }).click({ timeout: 15_000 });
  await page.getByRole('menuitem', { name: itemName }).click({ timeout: 15_000 });
}

/** Confirm the destructive alert dialog (Cancel/Delete) with "Delete". */
async function confirmDelete() {
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
}

await check('seeded vocabulary renders (tooling tag, Design category)', async () => {
  // The categories tab is the default; the tags tab needs one click.
  await catTree().getByText('Design', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('tab', { name: 'Tags' }).click();
  await tagList().getByText('tooling', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
});

await check('create tag adds it to the list', async () => {
  await panel().getByLabel('New tag').fill(tagName);
  await panel().getByRole('button', { name: 'Create', exact: true }).click();
  await tagRow(tagName).waitFor({ state: 'visible', timeout: 10_000 });
  assert((await tagList().getByText(tagName, { exact: true }).count()) === 1, `tag "${tagName}" not listed`);
});

await check('rename tag updates the list', async () => {
  await overflowAction(tagRow(tagName), `Edit ${tagName}`);
  const input = panel().getByPlaceholder('Tag name');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(tagRenamed);
  // Enter commits the inline edit (useInlineEdit: Enter → commit, Escape → cancel).
  await input.press('Enter');
  await tagRow(tagRenamed).waitFor({ state: 'visible', timeout: 10_000 });
  assert((await tagList().getByText(tagName, { exact: true }).count()) === 0, `old name "${tagName}" still listed`);
});

await check('deprecate then reactivate toggles the status badge', async () => {
  // Deprecate is the one directly-visible row action for active tags.
  await tagRow(tagRenamed).hover();
  await tagRow(tagRenamed).getByRole('button', { name: `Deprecate ${tagRenamed}` }).click({ timeout: 15_000 });
  await tagRow(tagRenamed).getByText('deprecated', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await tagRow(tagRenamed).hover();
  await tagRow(tagRenamed).getByRole('button', { name: `Reactivate ${tagRenamed}` }).click({ timeout: 15_000 });
  await tagRow(tagRenamed).getByText('active', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  assert(
    (await tagRow(tagRenamed).getByText('deprecated', { exact: true }).count()) === 0,
    'deprecated badge still visible after reactivation',
  );
});

await check('delete tag removes it after confirmation', async () => {
  await overflowAction(tagRow(tagRenamed), `Delete ${tagRenamed}`);
  await confirmDelete();
  await tagRow(tagRenamed).waitFor({ state: 'detached', timeout: 10_000 });
  assert((await tagList().getByText(tagRenamed, { exact: true }).count()) === 0, `"${tagRenamed}" still listed`);
});

await check('create root category adds it to the tree', async () => {
  await page.getByRole('tab', { name: 'Categories' }).click();
  await panel().getByLabel('New root category').fill(catName);
  await panel().getByRole('button', { name: 'Create', exact: true }).click();
  await catTree().getByText(catName, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
});

await check('delete category removes it after confirmation', async () => {
  const row = catTree().getByRole('listitem').filter({ hasText: catName });
  await overflowAction(row, `Delete ${catName}`);
  await confirmDelete();
  await row.waitFor({ state: 'detached', timeout: 10_000 });
  assert((await catTree().getByText(catName, { exact: true }).count()) === 0, `"${catName}" still in tree`);
});

const { pageErrors, consoleErrors } = errors.drain();
await check('no uncaught page errors', () => {
  if (consoleErrors.length > 0) {
    console.log(`E2E_INFO console errors (informational): ${consoleErrors.join(' | ')}`);
  }
  assert(
    pageErrors.length === 0,
    `uncaught page errors: ${pageErrors.join(' | ')}`,
  );
});

await finish();
