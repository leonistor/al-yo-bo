import type { BookmarkImage, BookmarkWithTags } from '@al-yo-bo/shared';
import {
  BookmarkIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PlusIcon,
  SearchXIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, hostOf } from '@/lib/format';
import type { Layout } from '@/lib/useLayout';
import { cn } from '@/lib/utils';

// Mirrors the server's `/data/screenshots/:filename` guard: a malformed or
// absolute stored path never reaches the route at all.
const SCREENSHOT_FILENAME = /^[0-9a-f-]{36}\.jpg$/i;

/**
 * Image fallback chain (ARCHITECTURE §8): local screenshot first, then the
 * remote og:image, otherwise nothing (the caller renders the placeholder).
 * `remote` marks the og:image case so the <img> can relax CORS/referrer.
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
 * Card thumbnail with the full fallback chain, including a failed <img> load
 * (dead remote URLs fall through to the placeholder instead of breaking).
 * Placeholder is a plain muted block with a globe mark — calm, no favicon
 * service round-trip.
 */
function CardThumb({ bookmark, layout }: { bookmark: BookmarkWithTags; layout: Layout }) {
  const [failed, setFailed] = useState(false);
  const markFailed = useCallback(() => setFailed(true), []);
  const resolved = failed ? null : resolveImageSrc(bookmark.image);

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground',
        layout === 'grid'
          ? '-mx-3 -mt-3 mb-1 aspect-video rounded-t-lg'
          : 'aspect-video w-24 rounded-md',
      )}
      aria-hidden={!resolved}
    >
      {resolved ? (
        <img
          src={resolved.src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover object-top"
          {...(resolved.remote ? { crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' } : {})}
          onError={markFailed}
        />
      ) : (
        <GlobeIcon className="size-4" aria-hidden />
      )}
    </div>
  );
}

interface BookmarkListProps {
  items: BookmarkWithTags[];
  loading: boolean;
  layout: Layout;
  /** True when a search query or category/tag filter is applied. */
  filtered: boolean;
  onOpen: (bookmark: BookmarkWithTags) => void;
  onDelete: (bookmark: BookmarkWithTags) => void;
  onAdd: () => void;
  onImport: () => void;
  onClearFilters: () => void;
}

/** Skeleton mirroring the real card anatomy so loading doesn't shift layout. */
function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-3" aria-hidden>
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-14" />
      </div>
      <Skeleton className="mt-2 h-3 w-1/3" />
      <Skeleton className="mt-2 h-3 w-full" />
      <Skeleton className="mt-1.5 h-3 w-5/6" />
      <div className="mt-2.5 flex gap-1">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
    </div>
  );
}

function BookmarkCard({
  bookmark,
  layout,
  onOpen,
  onDelete,
}: {
  bookmark: BookmarkWithTags;
  layout: Layout;
  onOpen: (bookmark: BookmarkWithTags) => void;
  onDelete: (bookmark: BookmarkWithTags) => void;
}) {
  const title = bookmark.title ?? bookmark.url;
  // Stable per-card handlers: the list re-renders on filter/page changes, and
  // fresh closures here would invalidate memoized rows.
  const handleOpen = useCallback(() => onOpen(bookmark), [onOpen, bookmark]);
  const handleDelete = useCallback(() => onDelete(bookmark), [onDelete, bookmark]);
  return (
    <article
      className={cn(
        'flex w-full gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground transition-colors hover:bg-accent/50',
        layout === 'grid' ? 'h-full flex-col' : 'flex-row items-start',
      )}
    >
      <CardThumb bookmark={bookmark} layout={layout} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={handleOpen}
            className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h3 className="truncate text-sm font-medium">{title}</h3>
          </button>
          <span className="shrink-0 self-center text-xs text-muted-foreground">
            {formatDate(bookmark.createdAt)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            render={
              <a
                href={bookmark.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${title} in a new tab`}
              />
            }
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${title}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2Icon />
          </Button>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{hostOf(bookmark.url)}</span>
          {bookmark.status === 'invalid' && <Badge variant="destructive">Invalid</Badge>}
        </p>
        {bookmark.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{bookmark.description}</p>
        )}
        {bookmark.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {bookmark.tags.map((tag) => (
              <Badge key={tag.tagId} variant="secondary">
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export function BookmarkList({
  items,
  loading,
  layout,
  filtered,
  onOpen,
  onDelete,
  onAdd,
  onImport,
  onClearFilters,
}: BookmarkListProps) {
  if (loading) {
    const skeletons = Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} />);
    if (layout === 'grid') {
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{skeletons}</div>
      );
    }
    return <div className="flex flex-col gap-2">{skeletons}</div>;
  }

  if (items.length === 0) {
    if (filtered) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>No matching bookmarks</EmptyTitle>
            <EmptyDescription>
              Nothing matches the current search and filters. Try different terms or clear them.
            </EmptyDescription>
            <EmptyContent>
              <Button variant="outline" onClick={onClearFilters}>
                Clear search &amp; filters
              </Button>
            </EmptyContent>
          </EmptyHeader>
        </Empty>
      );
    }
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookmarkIcon />
          </EmptyMedia>
          <EmptyTitle>Your library is empty</EmptyTitle>
          <EmptyDescription>
            Add your first bookmark or import an existing collection to get started.
          </EmptyDescription>
          <EmptyContent className="flex-row">
            <Button onClick={onAdd}>
              <PlusIcon data-icon="inline-start" />
              Add bookmark
            </Button>
            <Button variant="outline" onClick={onImport}>
              <UploadIcon data-icon="inline-start" />
              Import
            </Button>
          </EmptyContent>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div
      className={cn(
        layout === 'grid'
          ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
          : 'flex flex-col gap-2',
      )}
    >
      {items.map((bookmark) => (
        <BookmarkCard
          key={bookmark.id}
          bookmark={bookmark}
          layout={layout}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
