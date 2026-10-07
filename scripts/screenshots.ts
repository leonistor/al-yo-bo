/**
 * README screenshot runner.
 *
 * Boots the same disposable app instance the e2e harness uses (scratch
 * DATA_DIR, octocat seed, degraded env, guarded ports — scripts/lib/app-boot.ts),
 * then drives a headless Playwriter session through
 * scripts/screenshot-capture.mjs. The capture script executes inside the
 * playwriter relay daemon, which cannot receive env vars or CLI args from us,
 * so the job spec travels through a fixed /tmp path and finished PNGs come
 * back the same way (mirroring the e2e results-file convention); this runner
 * then copies them into docs/screenshots/ for README embedding.
 *
 * Usage:
 *   bun run screenshot                 # all shots, all configured themes
 *   bun run screenshot --light --dark  # explicit theme filter
 *   bun run screenshot --only library  # shots whose name contains "library"
 */

import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootApp, createSession, REPO_ROOT, teardown, teeLines, WEB_URL, type Boot } from './lib/app-boot';

const WORK_DIR = join(tmpdir(), 'al-yo-bo-screenshots');
const JOBS_FILE = join(WORK_DIR, 'jobs.json');
const OUT_DIR = join(REPO_ROOT, 'docs', 'screenshots');
const CAPTURE_FILE = join(REPO_ROOT, 'scripts', 'screenshot-capture.mjs');
const CAPTURE_TIMEOUT_MS = 180_000;
const VIEWPORT = { width: 1280, height: 800 };

type Theme = 'light' | 'dark';

interface Shot {
  name: string;
  route: string;
  themes: Theme[];
}

interface Job {
  name: string;
  route: string;
  theme: Theme;
}

/** Every README shot: name, hash route (apps/web/src/lib/router.ts), and its themes. */
const SHOTS: Shot[] = [
  { name: 'library', route: '#/', themes: ['light', 'dark'] },
  { name: 'import', route: '#/import', themes: ['light'] },
  { name: 'vocabulary', route: '#/vocabulary', themes: ['light'] },
];

function parseArgs(argv: string[]): { light: boolean; dark: boolean; only?: string } {
  const args = { light: false, dark: false } as { light: boolean; dark: boolean; only?: string };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--light') {
      args.light = true;
    } else if (argv[i] === '--dark') {
      args.dark = true;
    } else if (argv[i] === '--only' && argv[i + 1]) {
      args.only = argv[++i];
    }
  }
  return args;
}

function selectJobs(args: { light: boolean; dark: boolean; only?: string }): Job[] {
  const themes: Theme[] =
    args.light || args.dark
      ? [...(args.light ? (['light'] as const) : []), ...(args.dark ? (['dark'] as const) : [])]
      : ['light', 'dark'];
  return SHOTS.filter((shot) => !args.only || shot.name.includes(args.only)).flatMap((shot) =>
    themes
      .filter((theme) => shot.themes.includes(theme))
      .map((theme) => ({ name: shot.name, route: shot.route, theme })),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const jobs = selectJobs(args);
  if (jobs.length === 0) {
    throw new Error(
      `No shots matched${args.only ? ` "--only ${args.only}"` : ''} (light=${args.light} dark=${args.dark})`,
    );
  }

  // Fresh work dir: stale PNGs from a previous run must never be copied.
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });
  await Bun.write(
    JOBS_FILE,
    JSON.stringify({ baseUrl: WEB_URL, viewport: VIEWPORT, outDir: WORK_DIR, jobs }, null, 2),
  );

  let boot: Boot | null = null;
  let sessionId: string | null = null;
  try {
    boot = await bootApp('shots');
    sessionId = createSession();
    console.log(`[shots] headless session: ${sessionId}`);

    const proc = Bun.spawn({
      cmd: ['playwriter', '-s', sessionId, '-f', CAPTURE_FILE, '--timeout', String(CAPTURE_TIMEOUT_MS)],
      cwd: REPO_ROOT,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [, err] = await Promise.all([
      teeLines(proc.stdout, (line) => console.log(line)),
      teeLines(proc.stderr, (line) => console.log(`[playwriter] ${line}`)),
    ]);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`capture script exited with code ${exitCode}${err.at(-1) ? `: ${err.at(-1)}` : ''}`);
    }

    await mkdir(OUT_DIR, { recursive: true });
    const produced: string[] = [];
    for (const job of jobs) {
      const file = `${job.name}-${job.theme}.png`;
      const source = Bun.file(join(WORK_DIR, file));
      if (!(await source.exists())) {
        throw new Error(`capture did not produce ${file} (script said OK but the file is missing)`);
      }
      await Bun.write(join(OUT_DIR, file), source);
      produced.push(`docs/screenshots/${file}`);
    }
    console.log(`\n[shots] wrote ${produced.length} screenshot(s):`);
    for (const path of produced) {
      console.log(`[shots]   ${path}`);
    }
  } finally {
    await teardown(boot, sessionId, 'shots');
  }
}

await main();
