import type { BookmarkImage, BookmarkWithTags, Category, Tag } from '@al-yo-bo/shared';
import {
  CircleAlertIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  assignTagToBookmark,
  deleteBookmark,
  removeTagFromBookmark,
  scrapeBookmark,
  updateBookmark,
} from '@/lib/client';
import { formatDate, hostOf } from '@/lib/format';

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

// Mirrors the server's `/data/screenshots/:filename` guard: a malformed or
// absolute stored path never reaches the route at all.
const SCREENSHOT_FILENAME = /^[0-9a-f-]{36}\.jpg$/i;

/**
 * Image fallback chain (ARCHITECTURE §8): local screenshot first, then the
 * remote og:image, otherwise nothing (the caller renders the placeholder).
 */
function resolveImageSrc(
  image: BookmarkImage | undefined,
): { src: string; remote: boolean } | null {
  if (!image) {
    return null;
  }
  if (image.screenshotPath) {
    const filename = image.screenshotPath.split('/').pop() ?? '';
    if (SCREENSHOT_FILENAME.test(filename)) {
      return { src: `/data/screenshots/${filename}`, remote: false };
    }
  }
  if (image.ogImageUrl) {
    return { src: image.ogImageUrl, remote: true };
  }
  return null;
}

/**
 * Dialog header visual. Screenshots crop top-aligned (page heroes read best);
 * a failed <img> load falls through to the muted placeholder, never a broken
 * image. Keyed by bookmark id at the call site so the failed state resets
 * when a different bookmark opens.
 */
function HeaderImage({ bookmark }: { bookmark: BookmarkWithTags }) {
  const [failed, setFailed] = useState(false);
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
          onError={() => setFailed(true)}
        />
      ) : (
        <GlobeIcon className="size-6" aria-hidden />
      )}
    </div>
  );
}

interface BookmarkDetailDialogProps {
  bookmark: BookmarkWithTags | null;
  categories: Category[];
  tags: Tag[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onDeleted: () => void;
}

export function BookmarkDetailDialog({
  bookmark,
  categories,
  tags,
  onOpenChange,
  onChanged,
  onDeleted,
}: BookmarkDetailDialogProps) {
  const [current, setCurrent] = useState<BookmarkWithTags | null>(bookmark);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('none');
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);

  useEffect(() => {
    setCurrent(bookmark);
    setTitle(bookmark?.title ?? '');
    setDescription(bookmark?.description ?? '');
    setCategoryId(bookmark?.categoryId ?? 'none');
  }, [bookmark]);

  if (!current) {
    return null;
  }

  const availableTags = tags.filter(
    (tag) => !current.tags.some((assigned) => assigned.tagId === tag.id),
  );
  const isInvalid = current.status === 'invalid';
  const lastError = isInvalid ? scrapeLastError(current.metadata) : null;

  async function save() {
    setSaving(true);
    try {
      const updated = await updateBookmark(current!.id, {
        title: title.trim() || null,
        description: description.trim() || null,
        categoryId: categoryId === 'none' ? null : categoryId,
      });
      setCurrent(updated);
      toast.success('Bookmark updated');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function addTag(tagId: string) {
    try {
      const updated = await assignTagToBookmark(current!.id, tagId);
      setCurrent(updated);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign tag');
    }
  }

  async function removeTag(tagId: string) {
    try {
      await removeTagFromBookmark(current!.id, tagId);
      setCurrent({ ...current!, tags: current!.tags.filter((tag) => tag.tagId !== tagId) });
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
    }
  }

  async function remove() {
    try {
      await deleteBookmark(current!.id);
      toast.success('Bookmark deleted');
      onDeleted();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    }
  }

  async function scrape() {
    setScraping(true);
    try {
      const response = await scrapeBookmark(current!.id);
      setCurrent(response.bookmark);
      if (response.status === 'scraped') {
        toast.success('Page scraped');
      } else {
        toast.info('Page content unchanged');
      }
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to scrape');
    } finally {
      setScraping(false);
    }
  }

  return (
    <Dialog open={bookmark !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current.title ?? hostOf(current.url)}</DialogTitle>
          <DialogDescription>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {current.url}
              <ExternalLinkIcon className="size-3" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <HeaderImage key={current.id} bookmark={current} />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={current.scrapedAt ? 'secondary' : 'outline'}>
                {current.scrapedAt ? `Scraped ${formatDate(current.scrapedAt)}` : 'Not scraped'}
              </Badge>
              {isInvalid && <Badge variant="destructive">Invalid</Badge>}
            </div>
            <Button variant="outline" size="sm" onClick={scrape} disabled={scraping}>
              <RefreshCwIcon data-icon="inline-start" className={scraping ? 'animate-spin' : ''} />
              {scraping ? 'Scraping…' : current.scrapedAt ? 'Re-scrape' : 'Scrape page'}
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-title">Title</Label>
            <Input
              id="detail-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-description">Note</Label>
            <Textarea
              id="detail-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1">
              {current.tags.length === 0 && (
                <span className="text-xs text-muted-foreground">No tags yet.</span>
              )}
              {current.tags.map((tag) => (
                <Badge key={tag.tagId} variant="secondary" className="gap-1">
                  {tag.name}
                  {tag.source === 'user' && <span className="text-[0.65rem] opacity-70">user</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${tag.name}`}
                    onClick={() => removeTag(tag.tagId)}
                    className="ml-0.5 rounded-sm hover:text-destructive"
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            {availableTags.length > 0 && (
              <Select value="" onValueChange={addTag}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Add a tag…" />
                </SelectTrigger>
                <SelectContent>
                  {availableTags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this bookmark?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the bookmark and its tag assignments.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={save} disabled={saving}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
