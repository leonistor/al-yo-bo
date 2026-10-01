/**
 * One-off extractor: turns the Grimoire public demo's synthetic dataset into the
 * checked-in seed fixture used by `bun run db:seed`.
 *
 * The demo ships its data inside a hashed ES module
 * (`https://goniszewski.com/grimoire/demo/assets/state-*.js`). Download that file
 * and pass its path here; the script imports it, calls `createDemoState()` and
 * writes `packages/db/seeds/datasets/grimoire.seed.json` (the `grimoire` dataset
 * selected via `SEED_DATASET`, see `packages/db/src/seed.ts`).
 *
 * Usage:
 *   bun run scripts/extract-grimoire-seed.ts /path/to/downloaded-state.js
 *
 * The demo content is synthetic ("Grimoire demo editorial team"), so it is safe
 * to vendor as seed data — unlike `docs/examples-mds/*`, which are real user
 * collections and must never be treated as project content.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface DemoBookmark {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  category_id: string | null;
  tags: string[];
  is_archived?: number;
  is_trashed?: number;
  notes?: string | null;
  created_at: string;
}

interface DemoCategory {
  id: string;
  name: string;
  children: DemoCategory[];
}

interface DemoState {
  bookmarks: DemoBookmark[];
  categories: DemoCategory[];
}

interface DemoModule {
  createDemoState: () => DemoState;
  flattenCategories: (categories: DemoCategory[]) => DemoCategory[];
}

interface SeedBookmark {
  url: string;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  createdAt: number;
  metadata: Record<string, unknown>;
}

interface SeedFile {
  $comment: string;
  source: string;
  extractedAt: string;
  dataset: string;
  categories: string[];
  tags: string[];
  bookmarks: SeedBookmark[];
}

const modulePath = process.argv[2];
if (!modulePath) {
  console.error('Usage: bun run scripts/extract-grimoire-seed.ts <path-to-demo-state.js>');
  process.exit(1);
}

const demo = (await import(pathToFileURL(resolve(modulePath)).href)) as DemoModule;
const state = demo.createDemoState();
const flatCategories = new Map(demo.flattenCategories(state.categories).map((c) => [c.id, c]));

const visible = state.bookmarks.filter(
  (b) => (b.is_archived ?? 0) === 0 && (b.is_trashed ?? 0) === 0,
);

const bookmarks: SeedBookmark[] = visible.map((b) => ({
  url: b.url,
  title: b.title,
  description: b.description,
  category: b.category_id ? (flatCategories.get(b.category_id)?.name ?? null) : null,
  tags: [...b.tags].toSorted(),
  createdAt: Date.parse(b.created_at),
  metadata: { seed: { source: 'grimoire-demo', demoId: b.id, note: b.notes ?? null } },
}));

const categories = [
  ...new Set(bookmarks.map((b) => b.category).filter((c): c is string => Boolean(c))),
].toSorted();
const tags = [...new Set(bookmarks.flatMap((b) => b.tags))].toSorted();

const seed: SeedFile = {
  $comment:
    'Synthetic seed data extracted from the Grimoire public demo (https://goniszewski.com/grimoire/demo/). Not real user data.',
  source: 'https://goniszewski.com/grimoire/demo/',
  extractedAt: new Date().toISOString(),
  dataset: 'grimoire',
  categories,
  tags,
  bookmarks,
};

const outPath = resolve(import.meta.dir, '../packages/db/seeds/datasets/grimoire.seed.json');
await writeFile(outPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

console.log(
  `Wrote ${bookmarks.length} bookmarks, ${categories.length} categories, ${tags.length} tags → ${outPath}`,
);
