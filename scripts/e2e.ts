/**
 * E2E runner: boots an isolated app instance (scratch DATA_DIR, seeded octocat
 * fixture, server + web dev processes), then drives the real UI through the
 * Playwriter CLI in a disposable headless Chrome session.
 *
 * Design decisions:
 * - Root `.env` is intentionally NOT forwarded and AI-related env vars are
 *   stripped: without provider config the app runs in its documented degraded
 *   mode (keyword-only search, no classifier, no LLM chat) — the exact
 *   contract this suite asserts. Forwarding real keys would make scenarios
 *   depend on live AI providers.
 * - Processes are spawned detached so teardown can kill the whole process
 *   group (`bunx vite` leaves esbuild workers behind; a bare proc.kill() would
 *   orphan them and keep port 5173 busy for the next run).
 * - Scenarios are plain `.mjs` executed by `playwriter -f`; the runner only
 *   parses the `E2E_*` protocol lines from their stdout (e2e/helpers/assert.mjs).
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const SCENARIO_DIR = join(REPO_ROOT, 'e2e', 'scenarios');
const API_PORT = 3000;
const WEB_PORT = 5173;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SCENARIO_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 45_000;

/** Provider/sidecar env vars are excluded so the app under test stays degraded + offline. */
const STRIPPED_ENV = /^(OPENROUTER_API_KEY$|.*OLLAMA.*|.*OLLAYA.*|.*EMBED.*|.*OPENAI.*|VITE_ANNOTATE)/i;

interface Boot {
  scratchDir: string;
  server: Instance;
  web: Instance;
}

/** Structural surface of a spawned dev process the runner actually needs. */
interface Instance {
  proc: { pid: number; exited: Promise<number> };
  kill: () => void;
}

function parseArgs(argv: string[]): { only?: string; list: boolean } {
  const args = { list: false } as { only?: string; list: boolean };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only' && argv[i + 1]) {
      args.only = argv[++i];
    } else if (argv[i] === '--list') {
      args.list = true;
    }
  }
  return args;
}

function e2eEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIPPED_ENV.test(key)) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

/** Any HTTP response means the port is taken (by anything); refusal means free. */
async function isPortFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(750) });
    return false;
  } catch {
    return true;
  }
}

/**
 * Wait until both ports are free, then claim them with a jittered re-check.
 *
 * Concurrent harness runs (parallel agents validating scenarios) queue here
 * instead of failing fast. The jitter + second check narrows the window where
 * two runners both see "free" and race for the bind; a runner that still loses
 * the race exits nonzero (its child fails to bind) and the caller retries.
 */
async function waitForPortsFree(timeoutMs = 10 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    const free = await Promise.all([isPortFree(API_PORT), isPortFree(WEB_PORT)]);
    if (free[0] && free[1]) {
      await Bun.sleep(1000 + Math.random() * 2000);
      const recheck = await Promise.all([isPortFree(API_PORT), isPortFree(WEB_PORT)]);
      if (recheck[0] && recheck[1]) {
        return;
      }
    }
    if (!announced) {
      announced = true;
      console.log('[e2e] ports 3000/5173 busy — another harness run is active; queued ...');
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Ports ${API_PORT}/${WEB_PORT} still busy after ${timeoutMs / 1000}s — stop the other process (dev server or another e2e run) first.`,
      );
    }
    await Bun.sleep(2000);
  }
}

/** Tee lines to the console as they arrive and return the full text. */
async function teeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<string[]> {
  const lines: string[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        break;
      }
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      lines.push(line);
      onLine(line);
    }
  }
  if (buffer.length > 0) {
    lines.push(buffer);
    onLine(buffer);
  }
  return lines;
}

function spawnDetached(cmd: string[], cwd: string, env: Record<string, string>, logPrefix: string): Instance {
  const proc = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  });
  // Pumps run for the life of the child; not awaited here so boot continues.
  void teeLines(proc.stdout, (line) => console.log(`${logPrefix} ${line}`));
  void teeLines(proc.stderr, (line) => console.log(`${logPrefix} ${line}`));
  return {
    proc,
    kill: () => {
      try {
        process.kill(-proc.pid, 'SIGTERM');
      } catch {
        try {
          proc.kill();
        } catch {
          // already gone
        }
      }
    },
  };
}

async function waitForReady(url: string, label: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`${label} did not become ready within ${READY_TIMEOUT_MS}ms`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
}

async function bootApp(): Promise<Boot> {
  await waitForPortsFree();

  const scratchDir = await mkdtemp(join(tmpdir(), 'al-yo-bo-e2e-'));
  console.log(`[e2e] scratch data dir: ${scratchDir}`);

  const seed = Bun.spawnSync({
    cmd: ['bun', 'run', 'packages/db/src/seed.ts'],
    cwd: REPO_ROOT,
    env: e2eEnv({ DATA_DIR: scratchDir }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (seed.exitCode !== 0) {
    throw new Error(`Seeding failed:\n${seed.stderr.toString()}`);
  }
  console.log('[e2e] seeded octocat fixture');

  const server = spawnDetached(
    ['bun', '--hot', 'src/index.ts'],
    join(REPO_ROOT, 'apps', 'server'),
    e2eEnv({ DATA_DIR: scratchDir, PORT: String(API_PORT) }),
    '[server]',
  );
  const web = spawnDetached(['bunx', '--bun', 'vite'], join(REPO_ROOT, 'apps', 'web'), e2eEnv({}), '[web]');

  // Bind race loser: a child that exits within seconds of spawn means another
  // runner claimed a port between the free-check and the bind — fail fast with
  // a retryable error instead of a 45s readiness timeout.
  for (const [name, instance] of [
    ['server', server],
    ['web', web],
  ] as const) {
    const exited = await Promise.race([
      instance.proc.exited.then(() => true),
      Bun.sleep(3000).then(() => false),
    ]);
    if (exited) {
      throw new Error(`${name} dev process died at boot (lost the port race?) — rerun the suite.`);
    }
  }

  await waitForReady(`${API_URL}/api/health`, 'API server');
  const health = await fetch(`${API_URL}/api/health`).then((r) => r.json());
  console.log(`[e2e] health: ${JSON.stringify(health)}`);
  await waitForReady(WEB_URL, 'web dev server');
  console.log('[e2e] web ready');
  return { scratchDir, server, web };
}

function createSession(): string {
  const created = Bun.spawnSync({
    cmd: ['playwriter', 'session', 'new', '--browser', 'headless'],
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (created.exitCode !== 0) {
    throw new Error(
      `Could not create a headless playwriter session (is the playwriter CLI installed? run \`bun run browser:install\` once for the browser):\n${created.stderr.toString()}`,
    );
  }
  const output = created.stdout.toString();
  // `session new` prints e.g. "Session 3 created (headless). Use with: ..."
  const id = output.match(/^Session (\S+) created/m)?.[1];
  if (!id) {
    throw new Error(`Could not parse a session id from playwriter output:\n${output}`);
  }
  return id;
}

interface ScenarioOutcome {
  pass: boolean;
  reason: string | null;
  failedChecks: string[];
}

/** Results file convention — must match e2e/helpers/assert.mjs. */
function resultsFileFor(name: string): string {
  return join(tmpdir(), 'al-yo-bo-e2e-results', `${name.replace(/\W+/g, '-')}.jsonl`);
}

/**
 * Run one scenario and derive its outcome from the JSONL results file it
 * writes (sandbox console output is not reliably readable — the CLI dumps
 * only a tail of it on failure).
 */
async function runScenario(sessionId: string, file: string): Promise<ScenarioOutcome> {
  const name = (file.split('/').at(-1) ?? file).replace(/\.mjs$/, '');
  const resultsFile = resultsFileFor(name);
  await rm(resultsFile, { force: true });

  console.log(`\n[e2e] ── ${name} ${'─'.repeat(Math.max(4, 58 - name.length))}`);
  const proc = Bun.spawn({
    cmd: ['playwriter', '-s', sessionId, '-f', file, '--timeout', String(SCENARIO_TIMEOUT_MS)],
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

  const entries: { type: string; name?: string; pass?: boolean; message?: string }[] = [];
  try {
    const text = await Bun.file(resultsFile).text();
    for (const line of text.split('\n').filter(Boolean)) {
      entries.push(JSON.parse(line));
    }
  } catch {
    // no results file (scenario crashed before any check) — fall through
  }

  const failedChecks = entries
    .filter((e) => e.type === 'check' && e.pass === false)
    .map((e) => `${e.name}${e.message ? ` — ${e.message}` : ''}`);
  const result = entries.at(-1);
  if (result?.type === 'result') {
    return {
      pass: result.pass === true,
      reason: failedChecks.length > 0 ? `${failedChecks.length} check(s) failed` : null,
      failedChecks,
    };
  }
  return {
    pass: false,
    reason:
      exitCode === 0
        ? 'scenario ended without a result entry'
        : `playwriter exited with code ${exitCode}${err.at(-1) ? `: ${err.at(-1)}` : ''}`,
    failedChecks,
  };
}

async function discoverScenarios(only?: string): Promise<string[]> {
  const files = (await readdir(SCENARIO_DIR)).filter((f) => f.endsWith('.mjs')).toSorted();
  const selected = only ? files.filter((f) => f.includes(only)) : files;
  if (selected.length === 0) {
    throw new Error(`No scenarios matched${only ? ` "--only ${only}"` : ''} in ${SCENARIO_DIR}`);
  }
  return selected.map((f) => join(SCENARIO_DIR, f));
}

async function teardown(boot: Boot | null, sessionId: string | null): Promise<void> {
  if (sessionId) {
    Bun.spawnSync({ cmd: ['playwriter', 'session', 'delete', sessionId], stdout: 'ignore', stderr: 'ignore' });
  }
  if (boot) {
    boot.server.kill();
    boot.web.kill();
    // Wait until the ports actually free up; escalate to SIGKILL for stubborn
    // children (vite workers) so the next run never hits a busy port.
    for (const port of [API_PORT, WEB_PORT]) {
      for (let i = 0; i < 20 && !(await isPortFree(port)); i++) {
        if (i === 10) {
          boot.server.kill();
          boot.web.kill();
        }
        await Bun.sleep(250);
      }
    }
    await rm(boot.scratchDir, { recursive: true, force: true });
    console.log(`[e2e] tore down scratch dir ${boot.scratchDir}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = await discoverScenarios(args.only);
  if (args.list) {
    console.log(scenarios.join('\n'));
    return;
  }

  let boot: Boot | null = null;
  let sessionId: string | null = null;
  const started = Date.now();
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    boot = await bootApp();
    sessionId = createSession();
    console.log(`[e2e] headless session: ${sessionId}`);

    const results: { name: string; pass: boolean; reason: string | null; failedChecks: string[] }[] = [];
    for (const file of scenarios) {
      if (interrupted) {
        results.push({ name: file, pass: false, reason: 'interrupted', failedChecks: [] });
        continue;
      }
      const outcome = await runScenario(sessionId, file);
      results.push({
        name: file.split('/').at(-1) ?? file,
        pass: outcome.pass,
        reason: outcome.reason,
        failedChecks: outcome.failedChecks,
      });
    }

    const failed = results.filter((r) => !r.pass);
    console.log(`\n[e2e] ${'─'.repeat(60)}`);
    for (const r of results) {
      console.log(`[e2e] ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ` — ${r.reason}`}`);
      for (const check of r.failedChecks) {
        console.log(`[e2e]       ✗ ${check}`);
      }
    }
    console.log(
      `[e2e] ${results.length - failed.length}/${results.length} scenarios passed in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await teardown(boot, sessionId);
  }
}

await main();
