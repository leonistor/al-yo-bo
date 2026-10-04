import { useQuery } from '@tanstack/react-query';
import type { BookmarkListStatus, CategoryNode, ExportFormat, Tag } from '@al-yo-bo/shared';
import type { LucideIcon } from 'lucide-react';
import { BanIcon, CheckIcon, DownloadIcon, LayersIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { categoryOptionItems, flattenCategoryTree } from '@/lib/categories';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchBookmarks, type BookmarkSearchParams } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

/** Format choices with a one-line note on where each file is useful. */
const FORMAT_OPTIONS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'html', label: 'HTML', description: 'Browsers & bookmark managers' },
  { value: 'json', label: 'JSON', description: 'Full-fidelity backup' },
  { value: 'csv', label: 'CSV', description: 'Spreadsheets, Raindrop' },
  { value: 'markdown', label: 'Markdown', description: 'Notes apps, re-import' },
];

/** Status scope mirrors the Library toolbar plus "All" — a full backup legitimately includes invalid rows. */
const STATUS_OPTIONS: { value: BookmarkListStatus; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'All', icon: LayersIcon },
  { value: 'active', label: 'Active', icon: CheckIcon },
  { value: 'invalid', label: 'Invalid', icon: BanIcon },
];

const ALL = 'all';

interface FormatOptionProps {
  option: (typeof FORMAT_OPTIONS)[number];
  checked: boolean;
  onToggle: (format: ExportFormat, checked: boolean) => void;
}

/** One format row; binds the checkbox handler to its format with stable identity. */
function FormatOption({ option, checked, onToggle }: FormatOptionProps) {
  const id = `export-format-${option.value}`;
  const handleCheckedChange = useCallback(
    (value: boolean) => onToggle(option.value, value),
    [onToggle, option.value],
  );

  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={handleCheckedChange}
      />
      <div className="flex flex-col">
        <Label htmlFor={id}>{option.label}</Label>
        <p className="text-xs text-muted-foreground">{option.description}</p>
      </div>
    </div>
  );
}

interface ExportPageProps {
  /** The nested category tree; options flatten to `dev ▸ web` path labels. */
  categories: CategoryNode[];
  tags: Tag[];
}

/**
 * Export route page: pick formats and filters, watch the live match count, then
 * download a single file (or a `.zip` for multiple formats). The download is a
 * plain anchor navigation to `GET /api/export` — no fetch/blob plumbing.
 */
export function ExportPage({ categories, tags }: ExportPageProps) {
  const [formats, setFormats] = useState<ExportFormat[]>(['html']);
  const [status, setStatus] = useState<BookmarkListStatus>('active');
  const [categoryId, setCategoryId] = useState(ALL);
  const [tagId, setTagId] = useState(ALL);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [q, setQ] = useState('');
  const anchorRef = useRef<HTMLAnchorElement>(null);

  // Date-only strings compare lexically in ISO order; an empty bound is open.
  const datesValid = dateFrom === '' || dateTo === '' || dateFrom <= dateTo;

  const toggleFormat = useCallback((format: ExportFormat, checked: boolean) => {
    setFormats((current) =>
      checked ? [...current, format] : current.filter((item) => item !== format),
    );
  }, []);

  const handleCategoryChange = useCallback(
    (value: string | null) => setCategoryId(value ?? ALL),
    [],
  );
  const handleTagChange = useCallback((value: string | null) => setTagId(value ?? ALL), []);

  const handleQChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setQ(event.target.value),
    [],
  );
  const handleDateFromChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setDateFrom(event.target.value),
    [],
  );
  const handleDateToChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setDateTo(event.target.value),
    [],
  );

  const categoryOptions = useMemo(() => flattenCategoryTree(categories), [categories]);
  const categoryItems = useMemo(
    () => ({ [ALL]: 'All categories', ...categoryOptionItems(categoryOptions) }),
    [categoryOptions],
  );
  const tagItems = useMemo(
    () => ({
      [ALL]: 'All tags',
      ...Object.fromEntries(tags.map((tag) => [tag.id, tag.name])),
    }),
    [tags],
  );

  // Export filters omit empty fields; the URL repeats `formats` per selection.
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const format of formats) {
      params.append('formats', format);
    }
    params.set('status', status);
    const trimmed = q.trim();
    if (trimmed !== '') {
      params.set('q', trimmed);
    }
    if (categoryId !== ALL) {
      params.set('categoryId', categoryId);
    }
    if (tagId !== ALL) {
      params.set('tagId', tagId);
    }
    if (dateFrom !== '') {
      params.set('dateFrom', dateFrom);
    }
    if (dateTo !== '') {
      params.set('dateTo', dateTo);
    }
    return `/api/export?${params.toString()}`;
  }, [formats, status, q, categoryId, tagId, dateFrom, dateTo]);

  // Live preview: the search route with limit 1 exposes the exact match total.
  const previewParams = useMemo<BookmarkSearchParams>(
    () => ({
      ...(q.trim() !== '' ? { q: q.trim() } : {}),
      ...(categoryId !== ALL ? { categoryId } : {}),
      ...(tagId !== ALL ? { tagId } : {}),
      status,
      ...(dateFrom !== '' ? { dateFrom } : {}),
      ...(dateTo !== '' ? { dateTo } : {}),
      limit: 1,
    }),
    [q, categoryId, tagId, status, dateFrom, dateTo],
  );

  const previewQuery = useQuery({
    queryKey: queryKeys.bookmarks.list(previewParams),
    queryFn: () => fetchBookmarks(previewParams),
    enabled: datesValid,
  });

  const total = previewQuery.data?.total ?? 0;
  const canExport = formats.length > 0 && datesValid && total > 0;

  const handleExport = useCallback(() => {
    if (!canExport) {
      return;
    }
    anchorRef.current?.click();
    toast.success(`Exporting ${total} ${total === 1 ? 'bookmark' : 'bookmarks'}`, {
      description:
        formats.length > 1 ? `${formats.length} formats download as a single .zip` : undefined,
    });
  }, [canExport, total, formats.length]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 pb-3">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg font-semibold tracking-tight">Export</h1>
            <p className="text-xs text-muted-foreground">
              Download a filtered, portable copy of your bookmarks.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Formats */}
            <Card className="flex flex-col gap-3 p-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-medium">Formats</h2>
                <p className="text-xs text-muted-foreground">Choose at least one file to export.</p>
              </div>
              <div className="flex flex-col gap-2">
                {FORMAT_OPTIONS.map((option) => (
                  <FormatOption
                    key={option.value}
                    option={option}
                    checked={formats.includes(option.value)}
                    onToggle={toggleFormat}
                  />
                ))}
              </div>
              {formats.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Multiple formats download as a single .zip
                </p>
              )}
              {formats.length === 0 && (
                <p className="text-xs text-destructive">Select at least one format.</p>
              )}
            </Card>

            {/* Filters */}
            <Card className="flex flex-col gap-3 p-3">
              <h2 className="text-sm font-medium">Filters</h2>

              <SegmentedControl
                label="Status"
                value={status}
                onValueChange={setStatus}
                options={STATUS_OPTIONS}
              />

              <Field>
                <FieldLabel>Category</FieldLabel>
                <Select
                  items={categoryItems}
                  value={categoryId}
                  onValueChange={handleCategoryChange}
                >
                  <SelectTrigger aria-label="Category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All categories</SelectItem>
                    {categoryOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Tag</FieldLabel>
                <Select items={tagItems} value={tagId} onValueChange={handleTagChange}>
                  <SelectTrigger aria-label="Tag" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All tags</SelectItem>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="export-date-from">Created from</FieldLabel>
                  <Input
                    id="export-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={handleDateFromChange}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="export-date-to">Created to</FieldLabel>
                  <Input
                    id="export-date-to"
                    type="date"
                    value={dateTo}
                    onChange={handleDateToChange}
                  />
                </Field>
              </div>

              {!datesValid && (
                <p className="text-xs text-destructive">
                  The start date must be on or before the end date.
                </p>
              )}

              <Field>
                <FieldLabel htmlFor="export-q">Search text</FieldLabel>
                <Input
                  id="export-q"
                  type="search"
                  placeholder="Optional keyword…"
                  value={q}
                  onChange={handleQChange}
                />
              </Field>
            </Card>
          </div>

          {/* Live preview / empty state */}
          <Card className="p-3">
            <h2 className="text-sm font-medium">Preview</h2>
            {!datesValid ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Fix the date range to preview matches.
              </p>
            ) : previewQuery.isPending ? (
              <p className="mt-2 text-xs text-muted-foreground">Counting matches…</p>
            ) : total === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <DownloadIcon />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">No bookmarks match</EmptyTitle>
                  <EmptyDescription>
                    Adjust the filters above so at least one bookmark is included.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <p className="mt-2 text-sm" aria-live="polite">
                <span className="font-medium tabular-nums">{total}</span>{' '}
                {total === 1 ? 'bookmark matches' : 'bookmarks match'}
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* Sticky export bar: the hidden anchor is the actual download trigger. */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <a
          ref={anchorRef}
          href={exportUrl}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        >
          Export
        </a>
        <Button size="sm" onClick={handleExport} disabled={!canExport}>
          <DownloadIcon data-icon="inline-start" />
          Export {total} {total === 1 ? 'bookmark' : 'bookmarks'}
        </Button>
      </div>
    </div>
  );
}
