import { useMutation } from '@tanstack/react-query';
import type { BookmarkTagView, BookmarkWithTags, CategoryNode, Tag } from '@al-yo-bo/shared';
import {
  ChevronsUpDownIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { categoryOptionItems, flattenCategoryTree } from '@/lib/categories';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Field, FieldControl, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { TagPill } from '@/components/TagPill';
import {
  assignTagToBookmark,
  createTag,
  deleteBookmark,
  removeTagFromBookmark,
  scrapeBookmark,
  updateBookmark,
} from '@/lib/client';
import { formatDate, hostOf } from '@/lib/format';
import { resolveImageSrc } from '@/lib/image';

/** Stable delete trigger element; avoids recreating the Button on every render. */
// destructive-outline, not solid destructive: on mobile the sheet footer
// splits Delete onto its own full-width row in the thumb zone, where a solid
// red block reads as over-threatening (critique m03).
const DELETE_TRIGGER_BUTTON = <Button variant="destructive-outline" />;

interface ScrapeLastError {
  at?: number;
  status?: number;
  message?: string;
}

/**
 * Reads `metadata.scrape.lastError` (written by the server after repeated
 * dead-link scrape failures) out of the untyped metadata bag.
 */
function scrapeLastError(metadata: Record<string, unknown> | null): ScrapeLastError | null {
  const scrape = metadata?.scrape;
  if (!scrape || typeof scrape !== 'object') {
    return null;
  }
  const lastError = (scrape as Record<string, unknown>).lastError;
  if (!lastError || typeof lastError !== 'object') {
    return null;
  }
  const value = lastError as Record<string, unknown>;
  return {
    at: typeof value.at === 'number' ? value.at : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  };
}

/**
 * Sheet header visual. Screenshots crop top-aligned (page heroes read best);
 * a failed <img> load falls through to the muted placeholder, never a broken
 * image. Keyed by bookmark id at the call site so the failed state resets
 * when a different bookmark opens.
 */
function HeaderImage({ bookmark }: { bookmark: BookmarkWithTags }) {
  const [failed, setFailed] = useState(false);
  const markFailed = useCallback(() => setFailed(true), []);
  const resolved = failed ? null : resolveImageSrc(bookmark.image);

  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
      {resolved ? (
        <img
          src={resolved.src}
          alt=""
          decoding="async"
          draggable={false}
          className="size-full object-cover object-top"
          {...(resolved.remote ? { crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' } : {})}
          onError={markFailed}
        />
      ) : (
        <GlobeIcon className="size-6" aria-hidden />
      )}
    </div>
  );
}

interface TagComboboxProps {
  availableTags: Tag[];
  allTags: Tag[];
  onAssign: (tagId: string) => void;
}

/**
 * Searchable tag combobox with inline creation.
 *
 * The popup anchors to a button trigger and composes the coss command primitives
 * on top of base-ui Autocomplete (manual filtering via `mode="none"`). Selecting
 * an existing tag routes through the parent `addTag` handler; creating a tag uses
 * the shared `createTag` client path, then assigns the newly created tag through
 * the same `addTag` handler so validation, toast, and mutation paths stay unified.
 */
interface TagComboboxItemProps {
  tag: Tag;
  onSelect: (tagId: string) => void;
}

function TagComboboxItem({ tag, onSelect }: TagComboboxItemProps) {
  const handleClick = useCallback(() => onSelect(tag.id), [onSelect, tag.id]);

  return (
    <CommandItem value={tag.id} onClick={handleClick}>
      {tag.name}
    </CommandItem>
  );
}

interface CreateTagItemProps {
  name: string;
  onCreate: (name: string) => void;
}

function CreateTagItem({ name, onCreate }: CreateTagItemProps) {
  const handleClick = useCallback(() => onCreate(name), [onCreate, name]);

  return (
    <CommandItem value={`create:${name}`} onClick={handleClick}>
      <PlusIcon className="mr-2 size-4" />
      Create &quot;{name}&quot;
    </CommandItem>
  );
}

function TagCombobox({ availableTags, allTags, onAssign }: TagComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const trimmed = search.trim();
  const normalized = trimmed.toLowerCase();

  const filtered = availableTags.filter((tag) =>
    tag.name.toLowerCase().includes(normalized),
  );
  const exactMatch = allTags.find((tag) => tag.name.toLowerCase() === normalized);
  const canCreate = trimmed.length > 0 && !exactMatch;

  const handleAssign = useCallback(
    (tagId: string) => {
      setOpen(false);
      setSearch('');
      onAssign(tagId);
    },
    [onAssign],
  );

  const handleCreate = useCallback(
    async (name: string) => {
      setOpen(false);
      setSearch('');
      try {
        const created = await createTag({ name: name.trim() });
        onAssign(created.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to create tag');
      }
    },
    [onAssign],
  );

  const triggerRender = useMemo(
    () => (
      <Button
        id="detail-add-tag"
        variant="outline"
        size="sm"
        className="w-48 justify-between"
      />
    ),
    [],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={triggerRender}>
        <span className="text-muted-foreground">Add a tag…</span>
        <ChevronsUpDownIcon className="size-4 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command value={search} onValueChange={setSearch} mode="none">
          <CommandInput placeholder="Search tags…" aria-label="Search tags" />
          <CommandList className="max-h-60">
            {filtered.map((tag) => (
              <TagComboboxItem key={tag.id} tag={tag} onSelect={handleAssign} />
            ))}
            {canCreate && (
              <CreateTagItem name={trimmed} onCreate={handleCreate} />
            )}
            {filtered.length === 0 && !canCreate && (
              <CommandEmpty className="py-4 text-center text-xs">
                {normalized.length > 0 ? 'No matching tags.' : 'Type to create a new tag.'}
              </CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface AssignedTagPillProps {
  tag: BookmarkTagView;
  onRemove: (tagId: string) => void;
}

/** Assigned-tag pill with its remove affordance; owns the per-tag handler. */
function AssignedTagPill({ tag, onRemove }: AssignedTagPillProps) {
  const handleRemove = useCallback(() => onRemove(tag.tagId), [onRemove, tag]);

  return (
    <TagPill variant="removable" size="md" name={tag.name} onRemove={handleRemove}>
      {tag.name}
      {tag.source === 'user' && <span className="text-[0.65rem] opacity-70">user</span>}
    </TagPill>
  );
}

interface DetailTitleInputProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function DetailTitleInput({ value, onChange }: DetailTitleInputProps) {
  const render = useMemo(
    () => <Input id="detail-title" value={value} onChange={onChange} />,
    [value, onChange],
  );

  return (
    <Field>
      <FieldLabel>Title</FieldLabel>
      <FieldControl render={render} />
    </Field>
  );
}

interface DetailDescriptionInputProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

function DetailDescriptionInput({ value, onChange }: DetailDescriptionInputProps) {
  const render = useMemo(
    () => <Textarea id="detail-description" value={value} onChange={onChange} />,
    [value, onChange],
  );

  return (
    <Field>
      {/* htmlFor is explicit: base-ui's generated id loses to our stable
          DOM id on a plain-textarea render, leaving a dangling for. */}
      <FieldLabel htmlFor="detail-description">Note</FieldLabel>
      <FieldControl render={render} />
    </Field>
  );
}

interface DetailCategorySelectProps {
  categories: CategoryNode[];
  value: string;
  onValueChange: (value: string) => void;
}

function DetailCategorySelect({ categories, value, onValueChange }: DetailCategorySelectProps) {
  // Options flatten to `dev ▸ web` path labels — names are only sibling-unique.
  const options = useMemo(() => flattenCategoryTree(categories), [categories]);
  const items = useMemo(
    () => ({ none: 'No category', ...categoryOptionItems(options) }),
    [options],
  );

  const handleValueChange = useCallback(
    (v: string | null) => onValueChange(v ?? 'none'),
    [onValueChange],
  );

  return (
    <Field>
      <FieldLabel htmlFor="detail-category">Category</FieldLabel>
      <Select
        // items registers value→label pairs so SelectValue renders the
        // category path, not the raw id.
        items={items}
        value={value}
        onValueChange={handleValueChange}
      >
        <SelectTrigger id="detail-category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No category</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

interface BookmarkDetailSheetProps {
  bookmark: BookmarkWithTags | null;
  categories: CategoryNode[];
  tags: Tag[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onDeleted: () => void;
}

export function BookmarkDetailSheet({
  bookmark,
  categories,
  tags,
  onOpenChange,
  onChanged,
  onDeleted,
}: BookmarkDetailSheetProps) {
  const [current, setCurrent] = useState<BookmarkWithTags | null>(bookmark);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('none');

  useEffect(() => {
    setCurrent(bookmark);
    setTitle(bookmark?.title ?? '');
    setDescription(bookmark?.description ?? '');
    setCategoryId(bookmark?.categoryId ?? 'none');
  }, [bookmark]);

  // Mutations sit above the `!current` early return (rules of hooks). They can
  // only fire while the sheet is open, when `current` is non-null.
  const saveMutation = useMutation({
    mutationFn: async () =>
      updateBookmark(current!.id, {
        title: title.trim() || null,
        description: description.trim() || null,
        categoryId: categoryId === 'none' ? null : categoryId,
      }),
    onSuccess: (updated) => {
      setCurrent(updated);
      toast.success('Bookmark updated');
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update');
    },
  });

  const addTagMutation = useMutation({
    mutationFn: async (tagId: string) => assignTagToBookmark(current!.id, tagId),
    onSuccess: (updated) => {
      setCurrent(updated);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to assign tag');
    },
  });

  const removeTagMutation = useMutation({
    mutationFn: async (tagId: string) => removeTagFromBookmark(current!.id, tagId),
    onSuccess: (_, tagId) => {
      setCurrent((previous) =>
        previous ? { ...previous, tags: previous.tags.filter((tag) => tag.tagId !== tagId) } : previous,
      );
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteBookmark(current!.id),
    onSuccess: () => {
      toast.success('Bookmark deleted');
      onDeleted();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    },
  });

  const scrapeMutation = useMutation({
    mutationFn: async () => scrapeBookmark(current!.id),
    onSuccess: (response) => {
      setCurrent(response.bookmark);
      if (response.status === 'scraped') {
        toast.success('Page scraped');
      } else {
        toast.info('Page content unchanged');
      }
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to scrape');
    },
  });

  const handleTitleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
  }, []);

  const handleDescriptionChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(event.target.value);
  }, []);

  const closeSelf = useCallback(() => onOpenChange(false), [onOpenChange]);

  const availableTags = useMemo(
    () => tags.filter((tag) => !current?.tags.some((assigned) => assigned.tagId === tag.id)),
    [tags, current?.tags],
  );

  const handleScrape = useCallback(() => scrapeMutation.mutate(), [scrapeMutation]);
  const handleDelete = useCallback(() => deleteMutation.mutate(), [deleteMutation]);
  const handleSave = useCallback(() => saveMutation.mutate(), [saveMutation]);

  if (!current) {
    return null;
  }

  const isInvalid = current.status === 'invalid';
  const lastError = isInvalid ? scrapeLastError(current.metadata) : null;

  return (
    <Sheet open={bookmark !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-none gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="gap-3 border-b pb-4">
          <SheetTitle>{current.title ?? hostOf(current.url)}</SheetTitle>
          <SheetDescription>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {current.url}
              <ExternalLinkIcon className="size-3" />
            </a>
          </SheetDescription>
        </SheetHeader>

        {/* Sticky image header: stays put while the body below scrolls. */}
        <div className="shrink-0 px-6 pt-4">
          <HeaderImage key={current.id} bookmark={current} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={current.scrapedAt ? 'secondary' : 'outline'}>
                {current.scrapedAt ? `Scraped ${formatDate(current.scrapedAt)}` : 'Not scraped'}
              </Badge>
              {isInvalid && <Badge variant="destructive">Invalid</Badge>}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleScrape}
              disabled={scrapeMutation.isPending}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={scrapeMutation.isPending ? 'animate-spin' : ''}
              />
              {scrapeMutation.isPending
                ? 'Scraping…'
                : current.scrapedAt
                  ? 'Re-scrape'
                  : 'Scrape page'}
            </Button>
          </div>

          {isInvalid && (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <CircleAlertIcon className="size-4 text-destructive" />
                This link looks broken
              </p>
              <p className="text-xs text-muted-foreground">
                {lastError
                  ? `The last fetch failed${lastError.status ? ` (HTTP ${lastError.status})` : ''}${
                      lastError.message ? `: ${lastError.message}` : '.'
                    }`
                  : 'Trying to fetch the page failed more than once.'}
                {lastError?.at ? ` Last checked ${formatDate(lastError.at)}.` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                A successful re-scrape marks the bookmark as active again.
              </p>
            </div>
          )}
          <DetailTitleInput value={title} onChange={handleTitleChange} />
          <DetailDescriptionInput value={description} onChange={handleDescriptionChange} />
          <DetailCategorySelect
            categories={categories}
            value={categoryId}
            onValueChange={setCategoryId}
          />

          <Separator />

          <Field>
            <FieldLabel htmlFor="detail-add-tag">Tags</FieldLabel>
            <div className="flex w-full flex-col gap-2">
              <div className="flex flex-wrap gap-1">
                {current.tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">No tags yet.</span>
                )}
                {current.tags.map((tag) => (
                  <AssignedTagPill
                    key={tag.tagId}
                    tag={tag}
                    onRemove={removeTagMutation.mutate}
                  />
                ))}
              </div>
              <TagCombobox
                availableTags={availableTags}
                allTags={tags}
                onAssign={addTagMutation.mutate}
              />
            </div>
          </Field>
        </div>

        <SheetFooter className="sm:justify-between">
          <ConfirmDeleteDialog
            trigger={DELETE_TRIGGER_BUTTON}
            title="Delete this bookmark?"
            description="This permanently removes the bookmark and its tag assignments."
            confirmLabel="Delete"
            onConfirm={handleDelete}
          >
            <Trash2Icon data-icon="inline-start" />
            Delete
          </ConfirmDeleteDialog>

          <div className="flex gap-2">
            <Button variant="outline" onClick={closeSelf}>
              Close
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              Save
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
