import type { Database } from 'bun:sqlite';

import { listCategories, listCategoryPath, listTags } from '@al-yo-bo/db';
import type { DevProfile } from '@al-yo-bo/shared';
import type { SuggestClient, SuggestInput, VocabularySuggestion } from '@al-yo-bo/ai';

import type { CoreAi } from '../ai.ts';

export interface SetupServiceDeps {
  db: Database;
  ai: CoreAi;
}

export interface SuggestOutput {
  available: boolean;
  tags: VocabularySuggestion['tags'];
  categories: VocabularySuggestion['categories'];
}

export interface SetupService {
  /**
   * Asks the AI layer for vocabulary suggestions derived from the developer
   * profile. Nothing is persisted; the wizard commits checked suggestions via
   * `vocabulary.createBulk`.
   */
  suggest(devProfile: DevProfile): Promise<SuggestOutput>;
}

/** Builds the ancestor path (root → leaf) for one category. */
function categoryPath(db: Database, categoryId: string): string[] {
  return listCategoryPath(db, categoryId).map((category) => category.name);
}

/** Gathers existing vocabulary so the LLM can dedupe against it. */
function existingVocabulary(db: Database): SuggestInput['existing'] {
  return {
    tags: listTags(db).map((tag) => tag.name),
    categoryPaths: listCategories(db).map((category) => categoryPath(db, category.id)),
  };
}

export function createSetupService(deps: SetupServiceDeps): SetupService {
  const { db, ai } = deps;

  return {
    async suggest(devProfile) {
      const client: SuggestClient | null = ai.suggest;
      if (!client) {
        return { available: false, tags: [], categories: [] };
      }
      const result = await client.suggest({ devProfile, existing: existingVocabulary(db) });
      if (!result) {
        return { available: false, tags: [], categories: [] };
      }
      return { available: true, tags: result.tags, categories: result.categories };
    },
  };
}
