/**
 * Shared vocabulary-name guard. Both HTTP-edge and importer paths funnel
 * category/tag names through here, so a blank heading (`## `) cannot create
 * an empty row and the merge-by-name dedupe is a fair equality check (no
 * leading/trailing whitespace).
 */
export class InvalidVocabularyNameError extends Error {
  constructor(kind: 'category' | 'tag', message = 'name must be a non-empty string') {
    super(`${kind} ${message}`);
    this.name = 'InvalidVocabularyNameError';
  }
}

/**
 * Trims and rejects empty vocabulary names. The trim is intentional: the
 * importer parses markdown headings (`## foo`) and a stray `##  ` heading
 * otherwise reaches the row. Callers that want raw text need to opt out
 * upstream.
 */
export function requireVocabularyName(kind: 'category' | 'tag', name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new InvalidVocabularyNameError(kind);
  }
  return trimmed;
}