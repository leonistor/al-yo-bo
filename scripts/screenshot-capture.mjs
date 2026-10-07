/**
 * Playwriter-sandbox capture script for README screenshots.
 *
 * Runs via `playwriter -f` inside the relay daemon, so it cannot receive env
 * vars or CLI args from the runner (execution happens in the daemon, whose
 * environment is not ours — the same constraint that forces the e2e
 * results-file convention): the job spec is read from a fixed /tmp path
 * written by scripts/screenshots.ts, and PNGs are written to the same /tmp
 * dir for the runner to copy into docs/screenshots/.
 *
 * Per job: fresh document load with the theme pre-seeded in localStorage
 * (useTheme.ts reads `al-yo-bo:theme` at app boot), then wait for the same
 * shell-readiness marker the e2e openApp helper uses (the topbar search input
 * only renders after the profile query resolved and setup is complete).
 */

// The relay daemon executes `-f` files as a vm Script, not ESM: static
// `import` statements are a SyntaxError here (same reason e2e scenarios use
// dynamic imports) — node builtins must be pulled in with `await import`.
const { mkdir, readFile } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');

const WORK_DIR = join(tmpdir(), 'al-yo-bo-screenshots');
const JOBS_FILE = join(WORK_DIR, 'jobs.json');
const READY_TIMEOUT = 30_000;
const SETTLE_MS = 400;

const spec = JSON.parse(await readFile(JOBS_FILE, 'utf8'));
await mkdir(spec.outDir, { recursive: true });

// Playwriter globals (state/context) exist only in script top-level code.
if (!state.page || state.page.isClosed()) {
  state.page = await context.newPage();
}
const page = state.page;

// Freeze animations so a capture never lands mid-transition.
await page.emulateMedia({ reducedMotion: 'reduce' });

const failures = [];
for (const job of spec.jobs) {
  const shot = `${job.name}-${job.theme}`;
  try {
    await page.setViewportSize(spec.viewport);
    // Fresh document, then touch the app origin so localStorage is writable.
    await page.goto('about:blank');
    await page.goto(`${spec.baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((theme) => localStorage.setItem('al-yo-bo:theme', theme), job.theme);
    // Fresh document again so first paint already carries the chosen theme.
    await page.goto('about:blank');
    await page.goto(`${spec.baseUrl}/${job.route}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Search bookmarks').waitFor({ state: 'visible', timeout: READY_TIMEOUT });
    // Let fonts, images, and SSE-driven repaints settle before the shutter.
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: join(spec.outDir, `${shot}.png`) });
    console.log(`SCREENSHOT OK ${shot}`);
  } catch (error) {
    const message = error?.message ?? String(error);
    failures.push(`${shot}: ${message}`);
    console.log(`SCREENSHOT FAIL ${shot} :: ${message}`);
  }
}

if (failures.length > 0) {
  throw new Error(`${failures.length} screenshot(s) failed: ${failures.join('; ')}`);
}
