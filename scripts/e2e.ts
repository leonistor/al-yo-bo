/**
 * E2E runner: boots an isolated app instance (scratch DATA_DIR, seeded octocat
 * fixture, server + web dev processes), then drives the real UI through the
 * Playwriter CLI in a disposable headless Chrome session.
 *
 * The boot/teardown contract lives in scripts/lib/app-boot.ts (shared with
 * other runner scripts, e.g. the README screenshot capture) — this file keeps
 * only scenario discovery, execution, and result parsing.
 *
 * Scenarios are plain `.mjs` executed by `playwriter -f`; the runner only
 * parses the `E2E_*` protocol lines from their stdout (e2e/helpers/assert.mjs).
 */

import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootApp, createSession, REPO_ROOT, teardown, teeLines, type Boot } from './lib/app-boot';

const SCENARIO_DIR = join(REPO_ROOT, 'e2e', 'scenarios');
const SCENARIO_TIMEOUT_MS = 180_000;

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
