import type { ImportedBookmark } from '@al-yo-bo/shared';
import { BookmarkPlusIcon, FileUpIcon, SparklesIcon, WrenchIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ImportRow, type ImportRowPatch, type ImportRowState } from '@/components/ImportRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { commitImport, extractImport, type ImportPreview } from '@/lib/client';
import { navigate } from '@/lib/router';

/** Convert the editable row state back to the wire shape, once, at commit. */
function toImportedBookmark(row: ImportRowState): ImportedBookmark {
  const priorityText = row.priority.trim();
  const priority = priorityText === '' ? null : Number(priorityText);
  return {
    url: row.url.trim(),
    title: row.title.trim() === '' ? null : row.title.trim(),
    description: row.description.trim() === '' ? null : row.description.trim(),
    category: row.category.trim() === '' ? null : row.category.trim(),
    priority: priority !== null && Number.isFinite(priority) ? priority : null,
    tags: row.tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
  };
}

function toRow(bookmark: ImportedBookmark): ImportRowState {
  return {
    key: crypto.randomUUID(),
    included: true,
    url: bookmark.url,
    title: bookmark.title ?? '',
    description: bookmark.description ?? '',
    category: bookmark.category ?? '',
    priority: bookmark.priority === null ? '' : String(bookmark.priority),
    tagsText: bookmark.tags.join(', '),
  };
}

interface ImportPageProps {
  /** Called after a successful commit so the library can refetch. */
  onCommitted: () => void;
}

/**
 * Vertical-split import flow (plan Phase 4): source on the left, the editable
 * extraction result on the right. The server is only asked to commit what the
 * user confirms — edits live here until "Import N bookmarks".
 */
export function ImportPage({ onCommitted }: ImportPageProps) {
  const [sourceTab, setSourceTab] = useState<'paste' | 'upload'>('paste');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Omit<ImportPreview, 'bookmarks'> | null>(null);
  const [rows, setRows] = useState<ImportRowState[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Stable identity + functional updates: memoized rows don't re-render when
  // a sibling row is edited (plan acceptance: no whole-list re-render).
  const patchRow = useCallback((key: string, patch: ImportRowPatch) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
  }, []);

  const included = useMemo(() => rows.filter((row) => row.included), [rows]);

  // Client-side merge hint: importing the same URL twice upserts server-side,
  // so duplicates inside the paste collapse into one bookmark.
  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    let duplicates = 0;
    for (const row of included) {
      const url = row.url.trim();
      if (seen.has(url)) {
        duplicates += 1;
      } else {
        seen.add(url);
      }
    }
    return duplicates;
  }, [included]);

  async function readFile(file: File) {
    setText(await file.text());
    // Show what was loaded — opaque "file picked" state hides parser input.
    setSourceTab('paste');
    clearResults();
  }

  function clearResults() {
    setPreview(null);
    setRows([]);
  }

  async function handleExtract() {
    setExtracting(true);
    try {
      const result = await extractImport(text);
      setPreview({
        provider: result.provider,
        warnings: result.warnings,
        parsed: result.parsed,
        skipped: result.skipped,
      });
      setRows(result.bookmarks.map(toRow));
      if (result.warnings) {
        for (const warning of result.warnings) {
          toast.warning(warning);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Extract failed');
    } finally {
      setExtracting(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    try {
      const report = await commitImport(included.map(toImportedBookmark));
      toast.success(`Imported ${report.added} new, ${report.updated} updated`, {
        description:
          report.skipped > 0
            ? `${report.skipped} skipped · ${report.categoriesCreated} categories created`
            : undefined,
      });
      navigate('library');
      onCommitted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const extractDisabled = extracting || importing || text.trim() === '';
  const importDisabled = extracting || importing || included.length === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row">
      {/* Left pane: source input. Fixed half on desktop, stacks below md. */}
      <section
        aria-label="Import source"
        className="flex min-h-0 flex-col rounded-lg border border-border bg-card md:w-1/2 md:shrink-0"
      >
        <Tabs
          value={sourceTab}
          onValueChange={(value) => setSourceTab(value as 'paste' | 'upload')}
          className="min-h-0 flex-1"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <TabsList variant="line">
              <TabsTrigger value="paste">Paste text</TabsTrigger>
              <TabsTrigger value="upload">Upload file</TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              onClick={() => void handleExtract()}
              disabled={extractDisabled}
              aria-busy={extracting}
            >
              {extracting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SparklesIcon data-icon="inline-start" />
              )}
              Extract
            </Button>
          </div>

          <TabsContent value="paste" className="min-h-0">
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                clearResults();
              }}
              placeholder={'## dev\n\n- some tool: https://example.com'}
              aria-label="Import text"
              className="h-full min-h-64 flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-0"
            />
          </TabsContent>

          <TabsContent value="upload" className="min-h-0">
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 p-6 text-center">
              <FileUpIcon className="size-6 text-muted-foreground" />
              <Label htmlFor="import-file" className="text-sm font-medium">
                Markdown or plain-text collection
              </Label>
              <Input
                id="import-file"
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="max-w-xs"
                disabled={extracting || importing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void readFile(file);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                The file contents load into the paste tab, so you can review before extracting.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {/* Provider status: the preview response is the only thing that knows
            whether the LLM or the fallback parser produced the list. */}
        <p
          className="border-t border-border px-3 py-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {extracting ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="size-3" /> Extracting bookmarks…
            </span>
          ) : preview ? (
            preview.provider === 'llm' ? (
              <span className="inline-flex items-center gap-1.5">
                <SparklesIcon className="size-3" /> Extracted by LLM — {preview.parsed} parsed
                {preview.skipped > 0 && `, ${preview.skipped} skipped`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <WrenchIcon className="size-3" /> Fallback: deterministic parser — {preview.parsed}{' '}
                parsed
                {preview.skipped > 0 && `, ${preview.skipped} skipped`}
              </span>
            )
          ) : (
            'Paste or upload a collection, then press Extract.'
          )}
        </p>
      </section>

      {/* Right pane: editable extraction result + sticky commit bar. */}
      <section
        aria-label="Extracted bookmarks"
        className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-card"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-medium">Extracted bookmarks</h2>
          {rows.length > 0 && (
            <Badge variant="secondary">
              {included.length} of {rows.length}
            </Badge>
          )}
          {duplicateCount > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {duplicateCount} duplicate {duplicateCount === 1 ? 'URL' : 'URLs'} — merged on import
            </span>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {extracting ? (
            <div className="flex flex-col gap-2 p-3" aria-hidden>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookmarkPlusIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing extracted yet</EmptyTitle>
                <EmptyDescription>
                  Paste a collection or upload a file on the left, then press Extract. Every row is
                  editable here before anything is saved.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-2 p-3">
              {rows.map((row) => (
                <ImportRow key={row.key} row={row} onChange={patchRow} onRemove={removeRow} />
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={clearResults}
            disabled={extracting || importing || rows.length === 0}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleImport()}
            disabled={importDisabled}
            aria-busy={importing}
          >
            {importing && <Spinner data-icon="inline-start" />}
            Import {included.length} {included.length === 1 ? 'bookmark' : 'bookmarks'}
          </Button>
        </div>
      </section>
    </div>
  );
}
