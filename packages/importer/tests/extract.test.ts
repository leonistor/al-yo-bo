import { describe, expect, test } from 'bun:test';

import { extractionPrompt, fallbackExtraction } from '../src/extract.ts';

/**
 * Real collections copied from `docs/examples-mds/` so the deterministic
 * fallback is exercised against representative markdown. Kept local to the
 * importer package (the repo-wide samples are import-format examples only).
 */
const FIXTURES = ['imported-react.md', 'rust.md', 'shadcn.md', 'AI-dev-skills-scrape.md'];

function fixtureUrl(name: string): URL {
  return new URL(`./fixtures/extraction/${name}`, import.meta.url);
}

describe('extractionPrompt', () => {
  test('embeds the input verbatim and states the hard rules', () => {
    const prompt = extractionPrompt('hello https://example.com');
    expect(prompt.startsWith("Extract bookmarks from the user's free-form text.")).toBe(true);
    expect(prompt).toContain('Never invent URLs.');
    expect(prompt.endsWith('Input:\n"""\nhello https://example.com\n"""')).toBe(true);
  });

  test('instructs the empty-input case', () => {
    expect(extractionPrompt('')).toContain('If the input is empty, output `{ "bookmarks": [] }`.');
  });

  test('prompt shape is stable (golden)', () => {
    expect(extractionPrompt('## dev\n\n- x: https://example.com/x\n')).toMatchSnapshot();
  });
});

describe('fallbackExtraction', () => {
  test('wraps parseCollection for arbitrary markdown', () => {
    const bookmarks = fallbackExtraction('## dev\n\n- x: https://example.com/x\n');
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.url).toBe('https://example.com/x');
    expect(bookmarks[0]?.category).toBe('dev');
  });

  for (const name of FIXTURES) {
    test(`extracts ${name} deterministically (golden)`, async () => {
      const text = await Bun.file(fixtureUrl(name)).text();
      const first = fallbackExtraction(text);

      expect(first.length).toBeGreaterThan(0);
      // Pure function: repeated extraction yields identical output.
      expect(fallbackExtraction(text)).toEqual(first);
      // Only real HTTP(S) URLs make it through the parser.
      for (const bookmark of first) {
        expect(bookmark.url).toMatch(/^https?:\/\//);
      }
      expect(first).toMatchSnapshot();
    });
  }
});
