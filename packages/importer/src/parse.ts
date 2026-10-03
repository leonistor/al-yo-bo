import type { ImportedBookmark } from '@al-yo-bo/shared';

export interface ParseResult {
  bookmarks: ImportedBookmark[];
  skipped: number;
  /** Soft, non-fatal issues (e.g. unrecognized frontmatter keys) for the UI. */
  warnings?: string[];
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const H2_RE = /^##\s+(.*)$/;
const H3_RE = /^###\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const PRIORITY_RE = /^\*{1,3}(?=\s)/;
const FENCE_RE = /^`{3,}/;
const FRONTMATTER_DELIMITER = '---';
const FRONTMATTER_KEY_RE = /^([A-Za-z_][\w-]*)\s*:/;
const FRONTMATTER_LIST_ITEM_RE = /^\s*-\s/;
const FRONTMATTER_TAGS_RE = /^tags\s*:\s*\[(.*)\]\s*$/;

/**
 * Parses a markdown collection file (see ARCHITECTURE §7 Stage 1). The
 * `## Heading` (H2) is the section, `### Heading` (H3) is the category; when
 * only an H2 is present, the section name doubles as the catch-all category
 * (same shape as before). Heading context is collapsed into the single
 * `ImportedBookmark.category` field — the most specific name wins (H3 if
 * present, else H2). Fenced code blocks and frontmatter are handled as before.
 */
export function parseCollection(content: string): ParseResult {
  const bookmarks: ImportedBookmark[] = [];
  const seen = new Set<string>();
  const tags: string[] = [];
  const knownTags = new Set<string>();
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);
  let skipped = 0;
  let category: string | null = null;
  let inFence = false;
  let index = 0;

  while (index < lines.length) {
    const line = (lines[index] ?? '').trimEnd();

    if (inFence) {
      if (FENCE_RE.test(line.trim())) {
        inFence = false;
      }
      index += 1;
      continue;
    }

    if (FENCE_RE.test(line.trim())) {
      inFence = true;
      index += 1;
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const frontmatter = tryParseFrontmatter(lines, index);
    if (frontmatter) {
      for (const name of frontmatter.tags) {
        if (!knownTags.has(name)) {
          knownTags.add(name);
          tags.push(name);
        }
      }
      warnings.push(...frontmatter.warnings);
      index = frontmatter.endIndex + 1;
      continue;
    }

    const h3 = H3_RE.exec(line);
    if (h3) {
      category = h3[1]?.trim() ?? null;
      index += 1;
      continue;
    }

    const h2 = H2_RE.exec(line);
    if (h2) {
      category = h2[1]?.trim() ?? null;
      index += 1;
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (!bullet) {
      index += 1;
      continue;
    }

    let text = bullet[1]?.trim() ?? '';
    let priority: number | null = null;
    const priorityMatch = PRIORITY_RE.exec(text);
    if (priorityMatch) {
      priority = priorityMatch[0].length;
      text = text.slice(priorityMatch[0].length).trim();
    }

    const urls = [...text.matchAll(URL_RE)].map((match) => stripTrailingPunctuation(match[0]));
    if (urls.length === 0) {
      skipped += 1;
      index += 1;
      continue;
    }

    const note = stripUrls(text);
    for (const url of urls) {
      const key = url.toLowerCase();
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      bookmarks.push({
        url,
        title: note || null,
        description: note || null,
        category,
        priority,
        tags: [...tags],
      });
    }

    index += 1;
  }

  return warnings.length > 0 ? { bookmarks, skipped, warnings } : { bookmarks, skipped };
}

interface Frontmatter {
  tags: string[];
  /** Keys the parser does not understand but that were still consumed as frontmatter. */
  warnings: string[];
  endIndex: number;
}

/**
 * Recognizes a YAML frontmatter block starting at `startIndex`. To keep a
 * mid-file `---`-wrapped note (e.g. a `Note:` paragraph followed by bullets)
 * from vanishing silently, a block qualifies as frontmatter only when it is a
 * leading block (starts at file offset 0) or carries at least one recognized
 * key (`tags`). A block that is consumed but has unrecognized keys reports them
 * so the caller can warn rather than drop content.
 */
function tryParseFrontmatter(lines: string[], startIndex: number): Frontmatter | null {
  if ((lines[startIndex] ?? '').trim() !== FRONTMATTER_DELIMITER) {
    return null;
  }

  const tags: string[] = [];
  const unknownKeys = new Set<string>();
  let hasRecognizedKey = false;
  let firstNonBlank = true;
  let endIndex = -1;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();

    if (trimmed === FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
    if (!trimmed) {
      continue;
    }

    const keyMatch = FRONTMATTER_KEY_RE.exec(rawLine);
    const isKey = keyMatch !== null;
    const isListItem = FRONTMATTER_LIST_ITEM_RE.test(rawLine);
    if (firstNonBlank) {
      if (!isKey) {
        return null;
      }
      firstNonBlank = false;
    }
    if (!isKey && !isListItem) {
      return null;
    }

    if (isKey) {
      const key = keyMatch[1] ?? '';
      if (key === 'tags') {
        hasRecognizedKey = true;
        const tagMatch = FRONTMATTER_TAGS_RE.exec(rawLine);
        if (tagMatch) {
          for (const part of (tagMatch[1] ?? '').split(',')) {
            const name = part.trim();
            if (name) {
              tags.push(name);
            }
          }
        }
      } else {
        unknownKeys.add(key);
      }
    }
  }

  // An unclosed or empty block is not frontmatter.
  if (endIndex === -1 || firstNonBlank) {
    return null;
  }
  // A non-leading block needs a recognized key; otherwise the separator-wrapped
  // lines flow through as ordinary content instead of being swallowed.
  if (startIndex !== 0 && !hasRecognizedKey) {
    return null;
  }

  return {
    tags,
    warnings: [...unknownKeys].map(
      (key) => `Unrecognized frontmatter key "${key}" was ignored.`,
    ),
    endIndex,
  };
}

/**
 * Strips sentence punctuation glued to the end of a URL match. Trailing
 * `[.,;:!?]` are always prose artifacts. A trailing `)` or `]`, however, is
 * only stripped under the balanced-bracket rule: it is removed only when the
 * rest of the URL holds no unmatched `(`/`[` for it to close — otherwise the
 * bracket belongs to the URL (e.g. Wikipedia's
 * `https://en.wikipedia.org/wiki/Foo_(bar)`) and stripping stops there.
 */
function stripTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url.charAt(end - 1);
    if ('.,;:!?'.includes(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '[';
      if (unmatchedOpen(url.slice(0, end - 1), open, ch) > 0) {
        break;
      }
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

/** Count of `open` brackets in `text` left unclosed by a matching `close`. */
function unmatchedOpen(text: string, open: string, close: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === open) {
      depth += 1;
    } else if (ch === close && depth > 0) {
      depth -= 1;
    }
  }
  return depth;
}

function stripUrls(text: string): string {
  return text
    .replace(URL_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—:;,\s]+|[-–—:;,\s]+$/g, '')
    .trim();
}
