/**
 * Shared app boot for runner scripts that need a disposable, fully-seeded app
 * instance (the e2e suite, README screenshot capture).
 *
 * Contract (identical for every consumer):
 * - Fresh scratch `DATA_DIR` seeded with the octocat fixture; the seed marks
 *   setup complete so the first-run wizard never gates the UI.
 * - Server (:3000) + web dev server (:5173) spawned as detached children.
 * - Root `.env` is intentionally NOT forwarded and AI-related env vars are
 *   stripped: without provider config the app runs in its documented degraded
 *   mode (keyword-only search, no classifier, no LLM chat) — runs stay
 *   deterministic and never depend on live AI providers.
 * - `teardown` deletes the Playwriter session, kills process groups, and
 *   removes the scratch dir. Nothing touches `data/`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '..', '..');
export const API_PORT = 3000;
export const WEB_PORT = 5173;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const READY_TIMEOUT_MS = 45_000;

/** Provider/sidecar env vars are excluded so the app under test stays degraded + offline. */
const STRIPPED_ENV = /^(OPENROUTER_API_KEY$|.*OLLAMA.*|.*OLLAYA.*|.*EMBED.*|.*OPENAI.*|VITE_ANNOTATE)/i;

export interface Boot {
  scratchDir: string;
  server: Instance;
  web: Instance;
}

/** Structural surface of a spawned dev process the runner actually needs. */
interface Instance {
  proc: { pid: number; exited: Promise<number> };
  kill: () => void;
}

export function appEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIPPED_ENV.test(key)) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

/** Any HTTP response means the port is taken (by anything); refusal means free. */
export async function isPortFree(port: number): Promise<boolean> {
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
export async function waitForPortsFree(label = 'e2e', timeoutMs = 10 * 60_000): Promise<void> {
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
      console.log(`[${label}] ports 3000/5173 busy — another harness run is active; queued ...`);
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
export async function teeLines(
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

export function spawnDetached(cmd: string[], cwd: string, env: Record<string, string>, logPrefix: string): Instance {
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

export async function waitForReady(url: string, label: string): Promise<void> {
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

export async function bootApp(label = 'e2e'): Promise<Boot> {
  await waitForPortsFree(label);

  const scratchDir = await mkdtemp(join(tmpdir(), 'al-yo-bo-e2e-'));
  console.log(`[${label}] scratch data dir: ${scratchDir}`);

  const seed = Bun.spawnSync({
    cmd: ['bun', 'run', 'packages/db/src/seed.ts'],
    cwd: REPO_ROOT,
    env: appEnv({ DATA_DIR: scratchDir }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (seed.exitCode !== 0) {
    throw new Error(`Seeding failed:\n${seed.stderr.toString()}`);
  }
  console.log(`[${label}] seeded octocat fixture`);

  const server = spawnDetached(
    ['bun', '--hot', 'src/index.ts'],
    join(REPO_ROOT, 'apps', 'server'),
    appEnv({ DATA_DIR: scratchDir, PORT: String(API_PORT) }),
    '[server]',
  );
  const web = spawnDetached(['bunx', '--bun', 'vite'], join(REPO_ROOT, 'apps', 'web'), appEnv({}), '[web]');

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
  console.log(`[${label}] health: ${JSON.stringify(health)}`);
  await waitForReady(WEB_URL, 'web dev server');
  console.log(`[${label}] web ready`);
  return { scratchDir, server, web };
}

export function createSession(): string {
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

export async function teardown(
  boot: Boot | null,
  sessionId: string | null,
  label = 'e2e',
): Promise<void> {
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
    console.log(`[${label}] tore down scratch dir ${boot.scratchDir}`);
  }
}
