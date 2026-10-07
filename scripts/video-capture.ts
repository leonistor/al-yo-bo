/**
 * Demo-video capture runner.
 *
 * Boots the same disposable app instance the e2e/screenshot harnesses use
 * (scratch DATA_DIR, octocat seed, degraded env, guarded ports — see
 * scripts/lib/app-boot.ts), then launches a separate Playwright Chromium
 * (NOT the Playwriter harness — Playwright is a capture-only dev dep here)
 * and drives it through each scenario in scripts/video-scenarios.ts while
 * `playwright-recorder-plus` records the page to an mp4 in
 * apps/web/public/demos/.
 *
 * Why a separate Playwright instance? Two reasons:
 * 1. `playwright-recorder-plus` needs the Playwright `Page` API and the
 *    experimental `page.screencast`; the Playwriter relay does not.
 * 2. The e2e and screenshot harnesses stay on Playwriter; video capture is
 *    the only consumer of Playwright in the project.
 *
 * Pre-roll vs record:
 *   The first `navigate` step of every scenario is executed BEFORE recording
 *   starts. Without pre-roll, the screencast captures the empty boot frame
 *   (blank canvas, no theme applied). After pre-roll, `recorder.start()`
 *   is called and the first step's `holdMs` plus every subsequent step
 *   run inside the recorded timeline.
 *
 * Usage:
 *   bun run videos                 # all scenarios
 *   bun run videos --dry           # no recorder, just timing log
 *   bun run videos --only library  # scenarios whose name contains "library"
 */

import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';
import { attachRecorder } from 'playwright-recorder-plus';

import { bootApp, REPO_ROOT, teardown, WEB_URL, type Boot } from './lib/app-boot';
import { SCENARIOS, type Scenario, type Step } from './video-scenarios';

const OUT_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'demos');
const VIEWPORT = { width: 1280, height: 720 };
const STEP_TIMEOUT_MS = 30_000;
const FORCE_DEVICE_SCALE_FACTOR = 1;

interface Args {
  dry: boolean;
  only?: string;
}

function parseArgs(argv: string[]): Args {
  const args = { dry: false } as Args;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') {
      args.dry = true;
    } else if (argv[i] === '--only' && argv[i + 1]) {
      args.only = argv[++i];
    }
  }
  return args;
}

function selectScenarios(args: Args): Scenario[] {
  return SCENARIOS.filter((s) => !args.only || s.name.includes(args.only));
}

/** Remindit gotcha #3: CDP screencast does NOT capture the OS cursor, and
 *  a static page may stop emitting frames after ~200ms (white gaps in the
 *  recorded video). Inject a fixed cursor dot that pulses; it acts as both
 *  a faux cursor and a continuous-frame keepalive. */
const CURSOR_KEEPALIVE_INIT_SCRIPT = `
(() => {
  const styleText = \`
    .al-yo-bo-rec-cursor {
      position: fixed; left: 50%; top: 50%;
      width: 14px; height: 14px;
      margin: -7px 0 0 -7px;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.85);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35);
      z-index: 2147483647;
      pointer-events: none;
      animation: al-yo-bo-rec-cursor-pulse 1.1s ease-in-out infinite;
    }
    @keyframes al-yo-bo-rec-cursor-pulse {
      0%, 100% { transform: scale(1); opacity: 0.85; }
      50% { transform: scale(1.25); opacity: 0.5; }
    }
  \`;
  const dot = document.createElement('div');
  dot.className = 'al-yo-bo-rec-cursor';
  const apply = () => {
    if (document.head && !document.head.querySelector('style.al-yo-bo-rec-cursor')) {
      const s = document.createElement('style');
      s.className = 'al-yo-bo-rec-cursor';
      s.textContent = styleText;
      document.head.appendChild(s);
    }
    if (document.body && !document.body.querySelector('.al-yo-bo-rec-cursor')) {
      document.body.appendChild(dot);
    }
  };
  // Inject on every DOMContentLoaded; covers SPA route changes that re-create the tree.
  const onReady = () => {
    apply();
    document.addEventListener('DOMContentLoaded', apply);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})();
`;

function locatorFor(page: import('playwright').Page, selector: string): import('playwright').Locator {
  // Accepts CSS, role=, text=, placeholder=, and aria-label= prefixes.
  // We funnel everything through page.locator() which handles the same
  // string grammar Playwright's test runner uses.
  return page.locator(selector);
}

async function waitForStepMarker(
  page: import('playwright').Page,
  selector: string,
  stepKind: string,
  startedAt: number,
): Promise<void> {
  const locator = locatorFor(page, selector);
  await locator.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`[videos]   wait ok (${elapsed}s) — ${stepKind} → ${selector}`);
}

async function preRoll(
  page: import('playwright').Page,
  scenario: Scenario,
): Promise<{ firstStepIndex: number; firstHoldMs: number }> {
  // Find the first navigate step and execute it without recording so the
  // screencast never captures the empty boot frame.
  const firstIdx = scenario.steps.findIndex((s) => s.kind === 'navigate');
  if (firstIdx === -1) {
    return { firstStepIndex: 0, firstHoldMs: 0 };
  }
  const step = scenario.steps[firstIdx];
  if (step.kind !== 'navigate') {
    return { firstStepIndex: firstIdx, firstHoldMs: 0 };
  }
  console.log(`[videos] pre-roll: navigate ${step.route} + wait ${step.waitFor}`);
  await page.goto(`${WEB_URL}/${step.route}`, { waitUntil: 'domcontentloaded' });
  await waitForStepMarker(page, step.waitFor, 'pre-roll navigate', Date.now());
  return { firstStepIndex: firstIdx, firstHoldMs: step.holdMs ?? 0 };
}

async function runStep(
  page: import('playwright').Page,
  step: Step,
  stepIndex: number,
  totalSteps: number,
): Promise<void> {
  const label = `step ${stepIndex + 1}/${totalSteps}`;
  const startedAt = Date.now();
  let didHold = false;
  switch (step.kind) {
    case 'navigate': {
      console.log(`[videos] ${label}: navigate → ${step.route}`);
      await page.goto(`${WEB_URL}/${step.route}`, { waitUntil: 'domcontentloaded' });
      await waitForStepMarker(page, step.waitFor, 'navigate', startedAt);
      break;
    }
    case 'click': {
      const locator = locatorFor(page, step.selector);
      const count = await locator.count();
      console.log(`[videos] ${label}: click ${step.selector} (matches: ${count})`);
      if (count > 1) {
        const texts = await Promise.all(
          Array.from({ length: count }, (_, i) => locator.nth(i).innerText().catch(() => '?')),
        );
        console.log(`[videos]   matches: ${JSON.stringify(texts)}`);
      }
      await locator.first().click({ timeout: STEP_TIMEOUT_MS });
      await waitForStepMarker(page, step.waitFor, 'click', startedAt);
      break;
    }
    case 'fill': {
      const locator = locatorFor(page, step.selector);
      console.log(`[videos] ${label}: fill ${step.selector}`);
      await locator.first().fill(step.value);
      await waitForStepMarker(page, step.waitFor, 'fill', startedAt);
      break;
    }
    case 'wait': {
      console.log(`[videos] ${label}: wait ${step.selector}`);
      await waitForStepMarker(page, step.selector, 'wait', startedAt);
      break;
    }
    case 'hold': {
      console.log(`[videos] ${label}: hold ${step.ms}ms`);
      await page.waitForTimeout(step.ms);
      didHold = true;
      break;
    }
  }
  if (!didHold && step.kind !== 'hold' && step.holdMs && step.holdMs > 0) {
    console.log(`[videos] ${label}: hold ${step.holdMs}ms`);
    await page.waitForTimeout(step.holdMs);
  }
}

async function captureScenario(
  page: import('playwright').Page,
  scenario: Scenario,
  dry: boolean,
): Promise<{ outputPath: string; dry: boolean; recorderSkipped: boolean }> {
  console.log(`\n[videos] === ${scenario.name}-${scenario.theme} ===`);

  // Theme pre-seed: matches the screenshot pipeline convention. localStorage
  // is per-origin so we set it on a navigation to the app origin before the
  // real navigate (mirrors screenshot-capture.mjs).
  await page.goto(`${WEB_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((theme) => localStorage.setItem('al-yo-bo:theme', theme), scenario.theme);

  const { firstStepIndex, firstHoldMs } = await preRoll(page, scenario);

  if (dry) {
    console.log(`[videos] --dry: skipping recorder, replaying steps for timing only`);
    const startedAt = Date.now();
    for (let i = 0; i < scenario.steps.length; i++) {
      if (i === firstStepIndex) {
        if (firstHoldMs > 0) {
          console.log(`[videos] step ${i + 1}/${scenario.steps.length}: pre-roll hold ${firstHoldMs}ms (dry)`);
          await page.waitForTimeout(firstHoldMs);
        }
        continue;
      }
      await runStep(page, scenario.steps[i], i, scenario.steps.length);
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(`[videos] --dry total ${elapsed}s (target: <25s)`);
    return { outputPath: '', dry: true, recorderSkipped: true };
  }

  const outputPath = join(OUT_DIR, `${scenario.name}-${scenario.theme}.mp4`);
  await mkdir(OUT_DIR, { recursive: true });

  const recorder = await attachRecorder(page, {
    path: outputPath,
    autoStart: false,
    size: VIEWPORT,
    fps: 30,
  });
  await recorder.start();
  console.log(`[videos] recorder started → ${outputPath}`);

  try {
    for (let i = 0; i < scenario.steps.length; i++) {
      if (i === firstStepIndex) {
        if (firstHoldMs > 0) {
          console.log(`[videos] step ${i + 1}/${scenario.steps.length}: pre-roll hold ${firstHoldMs}ms`);
          await page.waitForTimeout(firstHoldMs);
        }
        continue;
      }
      await runStep(page, scenario.steps[i], i, scenario.steps.length);
    }
  } finally {
    await recorder.stop();
    console.log(`[videos] recorder stopped; awaiting finalization`);
  }

  const result = await recorder.finalized;
  console.log(`[videos] finalized: written=${result.written} path=${result.path ?? outputPath}`);
  return { outputPath, dry: false, recorderSkipped: false };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = selectScenarios(args);
  if (scenarios.length === 0) {
    throw new Error(`No scenarios matched${args.only ? ` "--only ${args.only}"` : ''}`);
  }

  // Mirror screenshots.ts: fresh work dir to avoid stale artifacts.
  const workDir = join(tmpdir(), 'al-yo-bo-videos');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  let boot: Boot | null = null;
  let browser: import('playwright').Browser | null = null;
  try {
    boot = await bootApp('videos');

    browser = await chromium.launch({
      headless: true,
      args: [`--force-device-scale-factor=${FORCE_DEVICE_SCALE_FACTOR}`],
    });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: FORCE_DEVICE_SCALE_FACTOR,
    });
    // Faux cursor + keepalive injection; runs on every navigation.
    await context.addInitScript(CURSOR_KEEPALIVE_INIT_SCRIPT);
    const page = await context.newPage();
    page.on('pageerror', (err) => console.log(`[videos] page error: ${err.message}`));

    const produced: string[] = [];
    for (const scenario of scenarios) {
      const result = await captureScenario(page, scenario, args.dry);
      if (!result.dry && !result.recorderSkipped) {
        produced.push(`apps/web/public/demos/${scenario.name}-${scenario.theme}.mp4`);
      }
    }
    if (produced.length > 0) {
      console.log(`\n[videos] wrote ${produced.length} video(s):`);
      for (const path of produced) {
        console.log(`[videos]   ${path}`);
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    await teardown(boot, null, 'videos');
  }
}

await main();