import type { ImportedBookmark } from '@al-yo-bo/shared';

export interface ImportPreview {
  parsed: number;
  skipped: number;
  bookmarks: ImportedBookmark[];
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  categoriesCreated: number;
  parsed: number;
}

async function postMarkdown<T>(path: string, markdown: string): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: markdown,
  });
  if (!response.ok) {
    throw new Error(`Import request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function previewImport(markdown: string): Promise<ImportPreview> {
  return postMarkdown<ImportPreview>('/api/import/preview', markdown);
}

export function runImport(markdown: string, file?: string): Promise<ImportResult> {
  const query = file ? `?file=${encodeURIComponent(file)}` : '';
  return postMarkdown<ImportResult>(`/api/import${query}`, markdown);
}
