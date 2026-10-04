import type { CategoryNode, ExportBookmarkRow, ExportFormat } from '@al-yo-bo/shared';

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
 * interchange format. The folder tree is the **category ancestor chain**, the
 * one path grammar decided for every format (ARCHITECTURE §7): each
 * `categoryPath` segment becomes one nested `<DT><H3>` + `<DL><p>` level and
 * bookmarks are `<A>` leaves. Timestamps are Unix seconds (< 2^32); `TAGS` is
 * comma-joined (the format has no comma escaping, so commas — and
 * newlines/quotes — inside tag names are stripped); the description lives in
 * `<DD>`; `& < >` are escaped in text and `"` additionally in attribute
 * values. The domain model carries no favicon data, so `ICON`/`ICON_URI` are
 * omitted entirely. Rows with an empty path sit directly in the top-level DL,
 * after the folders.
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

  appendHtmlFolders(lines, buildFolderTree(bookmarks), INDENT);
  for (const row of bookmarks) {
    if (row.categoryPath.length === 0) {
      appendHtmlBookmark(lines, row, INDENT);
    }
  }

  lines.push('</DL><p>');
  return lines.join('\n');
}

/**
 * Full-fidelity JSON backup. Shape:
 * `{ format: 'al-yo-bo/export', version: 2, exportedAt: <epoch ms>, filters,
 *    categories: CategoryNode[], bookmarks: ExportBookmarkRow[] }` —
 * timestamps stay epoch ms (domain-native), every row carries its resolved
 * `categoryPath` array, and `categories` is the tree as produced by
 * `getCategoryTree` (roots then children, ordered by the fractional
 * `sort_order` — the serializer passes it through verbatim; ordering is the
 * caller's contract, so this file stays a pure serializer).
 */
export function toExportJson(bookmarks: ExportBookmarkRow[], meta: ExportJsonMeta): string {
  return JSON.stringify(
    {
      format: 'al-yo-bo/export',
      version: 2,
      exportedAt: meta.exportedAt,
      filters: meta.filters,
      categories: meta.categories,
      bookmarks,
    },
    null,
    2,
  );
}

/** Metadata for `toExportJson` beyond the bookmark rows themselves. */
export interface ExportJsonMeta {
  filters: Record<string, unknown>;
  exportedAt: number;
  /** The category tree (`getCategoryTree` output), emitted verbatim. */
  categories: CategoryNode[];
}

/**
 * CSV with the Raindrop-compatible header `folder,url,title,note,tags,created`
 * (the best-known import target). `folder` is the category path joined with
 * `/` (empty when the bookmark is uncategorized); `note` is the description;
 * `tags` is one comma-joined field (commas in tag names are stripped —
 * Raindrop splits on commas, so they break consumers regardless); `created`
 * is ISO 8601; fields are quoted per RFC 4180.
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
 * Markdown in this app's own collection format — a tree-native mirror of
 * `packages/importer/parse.ts` (H2 → level-1 category, H3 → child), so an
 * export re-imports back into the same tree (ARCHITECTURE §7 round-trip).
 * Emission order: uncategorized rows first (the parser keeps the last heading
 * it saw and has no way to reset to "no category", so a bullet can only be
 * uncategorized before the first heading), then paths sorted segment-wise
 * with an H2 per level-1 change and an H3 per child. The parser's grammar is
 * depth-2, so segments beyond the second join into the H3 name with `/` —
 * deterministic, and the accepted fidelity limit of the markdown format.
 *
 * Further fidelity notes, all forced by the parser:
 * - The parser's tag set is file-global and only grows, so the frontmatter
 *   holds the union of every row's tags; rows with different tag sets are
 *   unioned rather than represented individually.
 * - The bullet note becomes both `title` and `description` on re-import, and
 *   the parser strips trailing `-–—:;,` from it.
 */
export function toMarkdownCollection(bookmarks: ExportBookmarkRow[]): string {
  const blocks: string[] = [];

  const tagNames = markdownTagNames(bookmarks);
  if (tagNames.length > 0) {
    blocks.push(['---', `tags: [${tagNames.join(', ')}]`, '---'].join('\n'));
  }

  const unpathed = bookmarks.filter((row) => row.categoryPath.length === 0);
  if (unpathed.length > 0) {
    blocks.push(unpathed.map((row) => markdownBullet(row)).join('\n'));
  }

  const rowsByPath = new Map<string, ExportBookmarkRow[]>();
  for (const row of bookmarks) {
    if (row.categoryPath.length === 0) {
      continue;
    }
    const key = JSON.stringify(row.categoryPath);
    const bucket = rowsByPath.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByPath.set(key, [row]);
    }
  }

  const paths = [...rowsByPath.keys()]
    .map((key) => JSON.parse(key) as string[])
    .toSorted(comparePaths);
  let currentRoot: string | null = null;
  for (const path of paths) {
    // `noUncheckedIndexedAccess`: a path in `rowsByPath` is never empty, but
    // the type system sees `string | undefined` — normalize with `?? ''`.
    const root = path[0] ?? '';
    const childPath = path.slice(1);
    if (root !== currentRoot) {
      blocks.push(`## ${root}`);
      currentRoot = root;
    }
    // The parser's grammar is depth-2; segments beyond the second join into
    // the H3 name with '/' (see the fidelity notes above).
    if (childPath.length > 0) {
      blocks.push(`### ${childPath.join('/')}`);
    }
    const rows = rowsByPath.get(JSON.stringify(path)) ?? [];
    blocks.push(rows.map((row) => markdownBullet(row)).join('\n'));
  }

  return blocks.join('\n\n');
}

interface FolderNode {
  name: string;
  /** Child folders in emission order (paths are pre-sorted, so siblings stay sorted). */
  children: FolderNode[];
  rows: ExportBookmarkRow[];
  /** Newest `createdAt` anywhere in this folder's subtree (its `ADD_DATE`). */
  newest: number;
}

/**
 * Folds rows into a folder trie keyed by their category ancestor chain.
 * Distinct paths are sorted segment-wise first and the skeleton is built in
 * that order, so sibling folders emit sorted; rows are then appended in input
 * order (the db's stable `created_at DESC` export order survives inside a
 * folder).
 */
function buildFolderTree(rows: ExportBookmarkRow[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];
  for (const path of distinctPaths(rows).toSorted(comparePaths)) {
    const prefix: string[] = [];
    let siblings = roots;
    for (const name of path) {
      prefix.push(name);
      const key = JSON.stringify(prefix);
      let node = nodes.get(key);
      if (!node) {
        node = { name, children: [], rows: [], newest: 0 };
        nodes.set(key, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  for (const row of rows) {
    if (row.categoryPath.length === 0) {
      continue;
    }
    const node = nodes.get(JSON.stringify(row.categoryPath));
    node?.rows.push(row);
  }
  for (const root of roots) {
    computeSubtreeNewest(root);
  }
  return roots;
}

/** Bottom-up newest `createdAt` per folder subtree (used for `ADD_DATE`). */
function computeSubtreeNewest(node: FolderNode): number {
  let newest = 0;
  for (const row of node.rows) {
    if (row.createdAt > newest) {
      newest = row.createdAt;
    }
  }
  for (const child of node.children) {
    const childNewest = computeSubtreeNewest(child);
    if (childNewest > newest) {
      newest = childNewest;
    }
  }
  node.newest = newest;
  return newest;
}

function appendHtmlFolders(lines: string[], folders: FolderNode[], indent: string): void {
  for (const folder of folders) {
    lines.push(
      `${indent}<DT><H3 ADD_DATE="${toUnixSeconds(folder.newest)}">${escapeHtmlText(folder.name)}</H3>`,
    );
    lines.push(`${indent}<DL><p>`);
    appendHtmlFolders(lines, folder.children, indent + INDENT);
    for (const row of folder.rows) {
      appendHtmlBookmark(lines, row, indent + INDENT);
    }
    lines.push(`${indent}</DL><p>`);
  }
}

function appendHtmlBookmark(lines: string[], row: ExportBookmarkRow, indent: string): void {
  const seconds = toUnixSeconds(row.createdAt);
  const tags = row.tags.map((tag) => sanitizeTagName(tag.name)).filter((name) => name.length > 0);
  const tagsAttribute = tags.length > 0 ? ` TAGS="${escapeHtmlAttribute(tags.join(','))}"` : '';
  lines.push(
    `${indent}<DT><A HREF="${escapeHtmlAttribute(row.url)}" ADD_DATE="${seconds}" LAST_MODIFIED="${seconds}"${tagsAttribute}>${escapeHtmlText(row.title ?? '')}</A>`,
  );
  if (row.description !== null && row.description.length > 0) {
    lines.push(`${indent}<DD>${escapeHtmlText(row.description)}`);
  }
}

/** Distinct category paths in first-seen order. */
function distinctPaths(rows: ExportBookmarkRow[]): string[][] {
  const seen = new Set<string>();
  const paths: string[][] = [];
  for (const row of rows) {
    if (row.categoryPath.length === 0) {
      continue;
    }
    const key = JSON.stringify(row.categoryPath);
    if (!seen.has(key)) {
      seen.add(key);
      paths.push(row.categoryPath);
    }
  }
  return paths;
}

/**
 * Segment-wise lexicographic comparison (`JSON.stringify` keys are injective
 * over paths, so keying by them never confuses a name containing `/` with a
 * path separator — the same rule the importer uses).
 */
function comparePaths(a: string[], b: string[]): number {
  const depth = Math.min(a.length, b.length);
  for (let i = 0; i < depth; i += 1) {
    const x = a[i] ?? '';
    const y = b[i] ?? '';
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return a.length - b.length;
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

/** The CSV `folder` column: the category path joined with `/`, empty when uncategorized. */
function folderPath(row: ExportBookmarkRow): string {
  return row.categoryPath.join('/');
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
