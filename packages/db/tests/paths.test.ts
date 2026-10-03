import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { defaultDbPath, resolveDataDir } from '../src/paths.ts';

/** Stubs DATA_DIR/PROFILE for a case; undefined means "unset". */
function withEnv(env: Record<string, string | undefined>) {
  for (const key of ['DATA_DIR', 'PROFILE'] as const) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
}

/**
 * `resolveDataDir` reads env at call time, so each case stubs DATA_DIR/PROFILE
 * directly and restores them afterwards — hermetic against both the repo .env
 * and a developer shell exporting PROFILE.
 */
describe('resolveDataDir', () => {
  const savedDataDir = process.env.DATA_DIR;
  const savedProfile = process.env.PROFILE;

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
    if (savedProfile === undefined) delete process.env.PROFILE;
    else process.env.PROFILE = savedProfile;
  });

  test('defaults to the repo-root data/ directory', () => {
    withEnv({});
    expect(resolveDataDir()).toBe(join(import.meta.dir, '../../..', 'data'));
  });

  test('anchors a relative DATA_DIR to the repo root and passes absolute values through', () => {
    withEnv({ DATA_DIR: 'tmp/custom-data' });
    expect(resolveDataDir()).toBe(join(import.meta.dir, '../../..', 'tmp/custom-data'));
    expect(resolveDataDir('/tmp/absolute')).toBe('/tmp/absolute');
  });

  test('an explicit argument beats env DATA_DIR', () => {
    withEnv({ DATA_DIR: 'from-env' });
    expect(resolveDataDir('from-arg')).toContain('from-arg');
  });

  test('PROFILE isolates the tree under data/profiles/<name> when DATA_DIR is unset', () => {
    withEnv({ PROFILE: 'leo' });
    expect(resolveDataDir()).toBe(join(import.meta.dir, '../../..', 'data/profiles/leo'));
  });

  test('DATA_DIR beats PROFILE', () => {
    withEnv({ DATA_DIR: 'explicit', PROFILE: 'leo' });
    expect(resolveDataDir()).toContain('explicit');
  });

  test('an invalid PROFILE name is ignored, not used as a path segment', () => {
    withEnv({ PROFILE: '../escape' });
    expect(resolveDataDir()).not.toContain('profiles');
    withEnv({ PROFILE: '/abs/profile' });
    expect(resolveDataDir()).not.toContain('profiles');
  });

  test('defaultDbPath shares the precedence chain', () => {
    withEnv({ PROFILE: 'leo' });
    expect(defaultDbPath()).toContain('data/profiles/leo/bookmarks.db');
    withEnv({ DATA_DIR: 'explicit', PROFILE: 'leo' });
    expect(defaultDbPath()).toContain('explicit/bookmarks.db');
    expect(defaultDbPath('arg-dir')).toContain('arg-dir/bookmarks.db');
  });
});
