import type { ExportBookmarkRow, ExportFormat } from '@al-yo-bo/shared';

/** MIME type per export format; every produced file is UTF-8. */
export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
};

/** Stable download filename per format; zip naming is the server edge's job. */
export function filenameFor(format: ExportFormat): string {
  switch (format) {
    case 'html':
      return 'alyobo-bookmarks.html';
    case 'json':
      return 'alyobo-bookmarks.json';
    case 'csv':
      return 'alyobo-bookmarks.csv';
    case 'markdown':
      return 'alyobo-bookmarks.md';
  }
}

/** `2^32 - 1`, the largest value the Netscape `ADD_DATE`/`LAST_MODIFIED` attributes can hold. */
const UNIX_SECONDS_MAX = 4_294_967_295;

const INDENT = '    ';

/**
 * Netscape Bookmark File Format export — the universal browser/manager
 * interchange format. Folder tree = Section ▸ Category (`<H3>` + nested
 * `<DL>`); timestamps are Unix seconds (< 2^32); `TAGS` is comma-joined (the
 * format has no comma escaping, so commas — and newlines/quotes — inside tag
 * names are stripped); the description lives in `<DD>`; `& < >` are escaped in
 * text and `"` additionally in attribute values. The domain model carries no
 * favicon data, so `ICON`/`ICON_URI` are omitted entirely.
 */
export function toNetscapeHtml(bookmarks: ExportBookmarkRow[]): string {
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];

  for (const section of groupRows(bookmarks)) {
    // Rows with no section sit directly in the top-level DL, grouped by category.
    if (section.name === null) {
      appendHtmlCategories(lines, section.categories, INDENT);
      continue;
    }
    lines.push(
      `${INDENT}<DT><H3 ADD_DATE="${folderDate(section.rows)}">${escapeHtmlText(section.name)}</H3>`,
    );
    lines.push(`${INDENT}<DL><p>`);
    appendHtmlCategories(lines, section.categories, INDENT + INDENT);
    lines.push(`${INDENT}</DL><p>`);
  }

  lines.push('</DL><p>');
  return lines.join('\n');
}

/**
 * Full-fidelity JSON backup. Shape:
 * `{ format: 'al-yo-bo/export', version: 1, exportedAt: <epoch ms>, filters,
 *    bookmarks: ExportBookmarkRow[] }` — timestamps stay epoch ms (domain-native)
 * and every row carries resolved `categoryName`/`sectionName`.
 */
export function toExportJson(
  bookmarks: ExportBookmarkRow[],
  meta: { filters: Record<string, unknown>; exportedAt: number },
): string {
  return JSON.stringify(
    {
      format: 'al-yo-bo/export',
      version: 1,
      exportedAt: meta.exportedAt,
      filters: meta.filters,
      bookmarks,
    },
    null,
    2,
  );
}

/**
 * CSV with the Raindrop-compatible header `folder,url,title,note,tags,created`
 * (the best-known import target). `folder` is the `Section/Category` path
 * (either part may be absent); `note` is the description; `tags` is one
 * comma-joined field (commas in tag names are stripped — Raindrop splits on
 * commas, so they break consumers regardless); `created` is ISO 8601; fields
 * are quoted per RFC 4180.
 */
export function toCsv(bookmarks: ExportBookmarkRow[]): string {
  const lines = ['folder,url,title,note,tags,created'];
  for (const row of bookmarks) {
    const tags = row.tags
      .map((tag) => tag.name.replaceAll(',', '').trim())
      .filter((name) => name.length > 0)
      .join(',');
    lines.push(
      [
        csvField(folderPath(row)),
        csvField(row.url),
        csvField(row.title ?? ''),
        csvField(row.description ?? ''),
        csvField(tags),
        csvField(new Date(row.createdAt).toISOString()),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Markdown in this app's own collection format (mirror of
 * `packages/importer/parse.ts`), so an export re-imports losslessly:
 * `## Section` / `### Category` headings (the parser flattens the most
 * specific heading into its single `category` field), a leading YAML
 * frontmatter `tags: [...]` block, bullet links, and leading `*` priority
 * stars exactly as the parser reads them.
 *
 * Fidelity notes, all forced by the parser:
 * - The parser's tag set is file-global and only grows, so the frontmatter
 *   holds the union of every row's tags; rows with different tag sets are
 *   unioned rather than represented individually.
 * - The parser keeps the last heading it saw with no way to reset, so rows
 *   whose `categoryName` is null must be emitted before any heading.
 * - The bullet note becomes both `title` and `description` on re-import, and
 *   the parser strips trailing `-–—:;,` from it.
 */
export function toMarkdownCollection(bookmarks: ExportBookmarkRow[]): string {
  const blocks: string[] = [];

  const tagNames = markdownTagNames(bookmarks);
  if (tagNames.length > 0) {
    blocks.push(['---', `tags: [${tagNames.join(', ')}]`, '---'].join('\n'));
  }

  // Null-category rows first: the parser keeps the last heading it saw, so a
  // bullet can only carry a null category before any heading appears.
  const rootRows = bookmarks.filter((row) => row.categoryName === null);
  if (rootRows.length > 0) {
    blocks.push(rootRows.map((row) => markdownBullet(row)).join('\n'));
  }

  const sections = groupRows(bookmarks.filter((row) => row.categoryName !== null));
  for (const section of sections) {
    if (section.name !== null) {
      blocks.push(`## ${section.name}`);
    }
    for (const category of section.categories) {
      if (category.name !== null) {
        blocks.push(`### ${category.name}`);
      }
      blocks.push(category.rows.map((row) => markdownBullet(row)).join('\n'));
    }
  }

  return blocks.join('\n\n');
}

interface CategoryGroup {
  name: string | null;
  rows: ExportBookmarkRow[];
}

interface SectionGroup {
  name: string | null;
  rows: ExportBookmarkRow[];
  categories: CategoryGroup[];
}

/**
 * Orders rows by `sectionName` (nulls last, alphabetical) then `categoryName`
 * (nulls last, alphabetical), preserving input order within a group, and folds
 * them into a Section ▸ Category tree. The sort is stable, so the db's
 * `created_at DESC` order survives inside each group.
 */
function groupRows(rows: ExportBookmarkRow[]): SectionGroup[] {
  const sorted = rows.toSorted(
    (a, b) =>
      compareNames(a.sectionName, b.sectionName) ||
      compareNames(a.categoryName, b.categoryName),
  );

  const sections: SectionGroup[] = [];
  for (const row of sorted) {
    let section = sections.at(-1);
    if (!section || section.name !== row.sectionName) {
      section = { name: row.sectionName, rows: [], categories: [] };
      sections.push(section);
    }
    section.rows.push(row);

    let category = section.categories.at(-1);
    if (!category || category.name !== row.categoryName) {
      category = { name: row.categoryName, rows: [] };
      section.categories.push(category);
    }
    category.rows.push(row);
  }
  return sections;
}

function compareNames(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a < b ? -1 : 1;
}

function appendHtmlCategories(
  lines: string[],
  categories: CategoryGroup[],
  indent: string,
): void {
  for (const category of categories) {
    if (category.name === null) {
      for (const row of category.rows) {
        appendHtmlBookmark(lines, row, indent);
      }
      continue;
    }
    lines.push(
      `${indent}<DT><H3 ADD_DATE="${folderDate(category.rows)}">${escapeHtmlText(category.name)}</H3>`,
    );
    lines.push(`${indent}<DL><p>`);
    for (const row of category.rows) {
      appendHtmlBookmark(lines, row, indent + INDENT);
    }
    lines.push(`${indent}</DL><p>`);
  }
}

function appendHtmlBookmark(lines: string[], row: ExportBookmarkRow, indent: string): void {
  const seconds = toUnixSeconds(row.createdAt);
  const tags = row.tags
    .map((tag) => sanitizeTagName(tag.name))
    .filter((name) => name.length > 0);
  const tagsAttribute = tags.length > 0 ? ` TAGS="${escapeHtmlAttribute(tags.join(','))}"` : '';
  lines.push(
    `${indent}<DT><A HREF="${escapeHtmlAttribute(row.url)}" ADD_DATE="${seconds}" LAST_MODIFIED="${seconds}"${tagsAttribute}>${escapeHtmlText(row.title ?? '')}</A>`,
  );
  if (row.description !== null && row.description.length > 0) {
    lines.push(`${indent}<DD>${escapeHtmlText(row.description)}`);
  }
}

/** Newest `createdAt` inside a folder, as Unix seconds (browsers ignore it; kept deterministic). */
function folderDate(rows: ExportBookmarkRow[]): number {
  let newest = 0;
  for (const row of rows) {
    if (row.createdAt > newest) {
      newest = row.createdAt;
    }
  }
  return toUnixSeconds(newest);
}

/** Epoch ms → Unix seconds, clamped to `[0, 2^32 - 1]` for the Netscape attributes. */
function toUnixSeconds(epochMs: number): number {
  const seconds = Math.floor(epochMs / 1000);
  if (seconds < 0) {
    return 0;
  }
  return Math.min(seconds, UNIX_SECONDS_MAX);
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replaceAll('"', '&quot;');
}

/** The Netscape/CSV tag grammars have no comma escaping, so commas (plus line breaks/quotes) are dropped. */
function sanitizeTagName(name: string): string {
  return name.replace(/[,\r\n"']/g, '').trim();
}

function folderPath(row: ExportBookmarkRow): string {
  if (row.sectionName !== null && row.categoryName !== null) {
    return `${row.sectionName}/${row.categoryName}`;
  }
  return row.sectionName ?? row.categoryName ?? '';
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Union of every row's tag names, deduped and in first-seen order. */
function markdownTagNames(bookmarks: ExportBookmarkRow[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of bookmarks) {
    for (const tag of row.tags) {
      const name = sanitizeTagName(tag.name);
      if (name.length > 0 && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Reads the personal priority back out of its domain-native location
 * (`metadata.import.priority`, where the importer stores it). Absent or
 * out-of-range values emit no stars.
 */
function priorityOf(row: ExportBookmarkRow): number | null {
  const imported = row.metadata?.['import'];
  if (imported === null || typeof imported !== 'object') {
    return null;
  }
  const priority = (imported as Record<string, unknown>)['priority'];
  if (typeof priority !== 'number' || !Number.isInteger(priority)) {
    return null;
  }
  return priority >= 1 && priority <= 3 ? priority : null;
}

/** `- [*** ]note url` — exactly the shape `parseCollection` reads back. */
function markdownBullet(row: ExportBookmarkRow): string {
  const priority = priorityOf(row);
  // The parser sets both title and description from the bullet note.
  const note = (row.title ?? row.description ?? '').replace(/[\r\n]+/g, ' ').trim();
  const parts = ['-'];
  if (priority !== null) {
    parts.push('*'.repeat(priority));
  }
  if (note.length > 0) {
    parts.push(note);
  }
  parts.push(row.url);
  return parts.join(' ');
}
