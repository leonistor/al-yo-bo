import type { ImportedBookmark } from '@al-yo-bo/shared';

export interface ParseResult {
  bookmarks: ImportedBookmark[];
  skipped: number;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const H2_RE = /^##\s+(.*)$/;
const H3_RE = /^###\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const PRIORITY_RE = /^\*{1,3}(?=\s)/;
const FENCE_RE = /^`{3,}/;
const FRONTMATTER_DELIMITER = '---';
const FRONTMATTER_KEY_RE = /^[A-Za-z_][\w-]*\s*:/;
const FRONTMATTER_LIST_ITEM_RE = /^\s*-\s/;
const FRONTMATTER_TAGS_RE = /^tags\s*:\s*\[(.*)\]\s*$/;

/**
 * Parses a markdown collection file (see ARCHITECTURE §7 Stage 1):
 *
 * - `## Heading` (H2) opens a category (created on demand at ingest).
 * - `### Heading` (H3) only sets section context; it never creates a category or tag.
 * - A leading `*`/`**`/`***` on a bullet is a personal priority (1–3), not a tag.
 * - Every URL in a bullet becomes a bookmark; the remaining note text stands in for
 *   title/description until the page is scraped.
 * - Fenced code blocks are opaque: their lines are never headings, bullets, or URL sources.
 * - YAML frontmatter `tags: [a, b]` accumulates positionally, so a bookmark never gains
 *   tags declared in a later block. Bare `---` separators between concatenated notes are
 *   not frontmatter unless the first interior non-blank line is a key line.
 * - Structural headings never create tags, and inline-tag syntax is deferred (§11).
 */
export function parseCollection(content: string): ParseResult {
  const bookmarks: ImportedBookmark[] = [];
  const seen = new Set<string>();
  const tags: string[] = [];
  const knownTags = new Set<string>();
  const lines = content.split(/\r?\n/);
  let skipped = 0;
  let category: string | null = null;
  let subsection: string | null = null;
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
      index = frontmatter.endIndex + 1;
      continue;
    }

    const h3 = H3_RE.exec(line);
    if (h3) {
      subsection = h3[1]?.trim() ?? null;
      index += 1;
      continue;
    }

    const h2 = H2_RE.exec(line);
    if (h2) {
      category = h2[1]?.trim() ?? null;
      subsection = null;
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
        subsection,
        priority,
        tags: [...tags],
      });
    }

    index += 1;
  }

  return { bookmarks, skipped };
}

interface Frontmatter {
  tags: string[];
  endIndex: number;
}

/**
 * Recognizes a YAML frontmatter block starting at `startIndex`. The first interior
 * non-blank line must be a key line, which keeps bare `---` horizontal separators
 * (common between concatenated notes) from being swallowed as frontmatter.
 */
function tryParseFrontmatter(lines: string[], startIndex: number): Frontmatter | null {
  if ((lines[startIndex] ?? '').trim() !== FRONTMATTER_DELIMITER) {
    return null;
  }

  const tags: string[] = [];
  let firstNonBlank = true;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();

    if (trimmed === FRONTMATTER_DELIMITER) {
      return firstNonBlank ? null : { tags, endIndex: index };
    }
    if (!trimmed) {
      continue;
    }

    const isKey = FRONTMATTER_KEY_RE.test(rawLine);
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
      const tagMatch = FRONTMATTER_TAGS_RE.exec(rawLine);
      if (tagMatch) {
        for (const part of (tagMatch[1] ?? '').split(',')) {
          const name = part.trim();
          if (name) {
            tags.push(name);
          }
        }
      }
    }
  }

  return null;
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[)\].,;:!?]+$/, '');
}

function stripUrls(text: string): string {
  return text
    .replace(URL_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—:;,\s]+|[-–—:;,\s]+$/g, '')
    .trim();
}
