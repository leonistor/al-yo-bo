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

/**
 * Parses a markdown collection file (see ARCHITECTURE §7 Stage 1):
 *
 * - `## Heading` (H2) opens a category (created on demand at ingest).
 * - `### Heading` (H3) only sets section context; it never creates a category or tag.
 * - A leading `*`/`**`/`***` on a bullet is a personal priority (1–3), not a tag.
 * - Every URL in a bullet becomes a bookmark; the remaining note text stands in for
 *   title/description until the page is scraped.
 * - Structural headings never create tags, and inline-tag syntax is deferred (§11).
 */
export function parseCollection(content: string): ParseResult {
  const bookmarks: ImportedBookmark[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let category: string | null = null;
  let subsection: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const h3 = H3_RE.exec(line);
    if (h3) {
      subsection = h3[1]?.trim() ?? null;
      continue;
    }

    const h2 = H2_RE.exec(line);
    if (h2) {
      category = h2[1]?.trim() ?? null;
      subsection = null;
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (!bullet) {
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
      });
    }
  }

  return { bookmarks, skipped };
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
