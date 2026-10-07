/**
 * Minimal assertion + reporting helpers for e2e scenarios.
 *
 * Scenarios run inside the Playwriter sandbox via `playwriter -f <file>`, so
 * this module is loaded with a repo-root-relative dynamic import (relative
 * paths resolve from the directory the session was created in — the repo
 * root).
 *
 * Results are written as JSONL to `$E2E_RESULTS_FILE` (set by the runner) and
 * mirrored to the console. The file is the source of truth: the playwriter
 * CLI only dumps a *tail* of console output on failure, so protocol-by-stdout
 * loses early lines to browser console noise. Appending per check means even
 * a scenario killed mid-run leaves its progress on disk.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Results live at a path derived from the scenario name. The runner deletes
 * the file before spawning and reads it after exit; scenarios cannot receive
 * env vars from the runner (execution happens inside the relay daemon, whose
 * environment is not ours), so the path is a fixed convention keyed on the
 * scenario name.
 */
let scenarioName = 'unknown';

function resultsPath() {
  return join(tmpdir(), 'al-yo-bo-e2e-results', `${scenarioName.replace(/\W+/g, '-')}.jsonl`);
}

let passed = 0;
let failed = 0;
const failures = [];

async function record(entry) {
  try {
    await mkdir(join(resultsPath(), '..'), { recursive: true });
    await appendFile(resultsPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.log(`E2E_INFO could not record result: ${error?.message ?? error}`);
  }
}

/** Announce the scenario; the runner keys results on this entry. */
export async function beginScenario(name) {
  scenarioName = name;
  console.log(`E2E_SCENARIO ${name}`);
  await record({ type: 'scenario', name });
}

/**
 * Run one named check. A failing check is recorded and reported but does not
 * abort the scenario — later checks still run so one broken selector does not
 * hide five other regressions.
 */
export async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`E2E_CHECK PASS ${name}`);
    await record({ type: 'check', name, pass: true });
  } catch (error) {
    failed += 1;
    const message = error?.message ?? String(error);
    failures.push({ name, message });
    console.log(`E2E_CHECK FAIL ${name} :: ${message}`);
    await record({ type: 'check', name, pass: false, message });
  }
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, label) {
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/**
 * Record the final result and throw on failure so the playwriter CLI (and
 * therefore the runner) exits non-zero.
 */
export async function finish() {
  console.log(`E2E_CHECKS ${passed} passed, ${failed} failed`);
  const result = { type: 'result', pass: failed === 0, passed, failed };
  await record(result);
  if (failed > 0) {
    console.log(`E2E_RESULT FAIL ${failed} check(s) failed: ${failures.map((f) => f.name).join('; ')}`);
    throw new Error(`${failed} e2e check(s) failed: ${failures.map((f) => `${f.name} (${f.message})`).join('; ')}`);
  }
  console.log('E2E_RESULT PASS');
}
