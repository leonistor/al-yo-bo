import { beforeEach, describe, expect, test } from 'bun:test';

import { createCategory, createTag } from '@al-yo-bo/db';
import type { DevProfile } from '@al-yo-bo/shared';

import { createSetupService } from '../src/services/setup.ts';
import { makeDb, stubAi, stubSuggest } from './support.ts';

describe('SetupService.suggest', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  test('returns suggestions when an AI suggest client is configured', async () => {
    createTag(db, { name: 'rust' });
    createCategory(db, { name: 'dev' });
    createCategory(db, { name: 'web', parentId: createCategory(db, { name: 'dev' }).id });

    const captured: { devProfile: DevProfile; existing: { tags: string[]; categoryPaths: string[][] } }[] = [];
    const suggest = stubSuggest({ tags: ['wasm'], categories: [['dev', 'systems']] });
    const customSuggest: typeof suggest = {
      async suggest(input) {
        captured.push(input);
        return suggest.suggest(input);
      },
    };
    const service = createSetupService({ db, ai: stubAi({ suggest: customSuggest }) });

    const devProfile: DevProfile = { source: 'questionnaire', focus: 'systems' };
    const result = await service.suggest(devProfile);

    expect(result.available).toBe(true);
    expect(result.tags).toEqual([{ name: 'wasm' }]);
    expect(result.categories).toEqual([{ path: ['dev', 'systems'] }]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.devProfile).toEqual(devProfile);
    expect(captured[0]!.existing.tags).toEqual(['rust']);
    expect(captured[0]!.existing.categoryPaths).toEqual([['dev'], ['dev', 'web']]);
  });

  test('degrades to available:false when no suggest client is configured', async () => {
    createTag(db, { name: 'existing' });
    const service = createSetupService({ db, ai: stubAi() });

    const result = await service.suggest({ source: 'questionnaire' });

    expect(result.available).toBe(false);
    expect(result.tags).toEqual([]);
    expect(result.categories).toEqual([]);
  });

  test('degrades to available:false when the client returns null', async () => {
    const service = createSetupService({
      db,
      ai: stubAi({
        suggest: {
          async suggest() {
            return null;
          },
        },
      }),
    });

    const result = await service.suggest({ source: 'questionnaire' });

    expect(result.available).toBe(false);
    expect(result.tags).toEqual([]);
    expect(result.categories).toEqual([]);
  });
});
