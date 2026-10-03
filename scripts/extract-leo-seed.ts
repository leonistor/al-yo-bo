/**
 * Regenerates the `leo` seed fixture from Leo's real markdown collections.
 *
 * The collections live in `docs/examples-mds/` (a five-file representative
 * sample of Leo's Zen bookmark archive). This script parses each file with the
 * same importer the app uses, dedupes URLs across files (first file wins), and
 * writes `packages/db/seeds/datasets/leo.seed.json` — the `leo` dataset selected
 * via `SEED_DATASET` (see `packages/db/src/seed.ts`).
 *
 * Usage:
 *   bun run scripts/extract-leo-seed.ts
 *
 * The archive's markdown does not carry per-note dates, so every seeded bookmark
 * shares the archive export timestamp below. That keeps regeneration deterministic.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseCollection } from '../packages/importer/src/index.ts';

const SOURCE_DIR = resolve(import.meta.dir, '../docs/examples-mds');
const OUT_PATH = resolve(import.meta.dir, '../packages/db/seeds/datasets/leo.seed.json');

/** Zen archive export timestamp (`metadata.json.exportDate`). */
const EXPORTED_AT = Date.parse('2026-10-01T03:51:23Z');

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
  /** Names the singleton profile — this fixture IS the user's collection. */
  profileName: string;
  categories: string[];
  tags: string[];
  bookmarks: SeedBookmark[];
}

const files = (await readdir(SOURCE_DIR)).filter((name) => name.endsWith('.md')).toSorted();

const seen = new Set<string>();
const bookmarks: SeedBookmark[] = [];
let skipped = 0;

for (const file of files) {
  // One-off extraction script: sequential reads keep the dedupe/output order
  // trivially predictable.
  // oxlint-disable-next-line no-await-in-loop
  const content = await readFile(join(SOURCE_DIR, file), 'utf8');
  const parsed = parseCollection(content);
  skipped += parsed.skipped;

  for (const entry of parsed.bookmarks) {
    const key = entry.url.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    bookmarks.push({
      url: entry.url,
      title: entry.title,
      description: entry.description,
      category: entry.category,
      tags: [...entry.tags].toSorted(),
      createdAt: EXPORTED_AT,
      metadata: {
        import: {
          file,
          category: entry.category,
          priority: entry.priority,
        },
      },
    });
  }
}

const categories = [
  ...new Set(bookmarks.map((b) => b.category).filter((c): c is string => Boolean(c))),
].toSorted();
const tags = [...new Set(bookmarks.flatMap((b) => b.tags))].toSorted();

const seed: SeedFile = {
  $comment:
    "Real bookmark collections from Leo's personal Zen archive — a five-file representative sample. Not project content.",
  source: 'docs/examples-mds/',
  extractedAt: new Date().toISOString(),
  dataset: 'leo',
  profileName: 'leo',
  categories,
  tags,
  bookmarks,
};

await writeFile(OUT_PATH, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

console.log(
  `Wrote ${bookmarks.length} bookmarks, ${categories.length} categories, ${tags.length} tags ` +
    `(${skipped} skipped) from ${files.length} files → ${OUT_PATH}`,
);
