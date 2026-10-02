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
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { TagPill } from '@/components/TagPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
function CardSkeleton({ layout }: { layout: Layout }) {
  return (
    <Card
      className={cn(
        'w-full overflow-hidden',
        layout === 'grid' ? 'h-full flex-col p-3' : 'flex-row items-start gap-3 p-3',
      )}
      aria-hidden
    >
      {layout === 'grid' ? (
        <div className="-mx-3 -mt-3 mb-1 aspect-video rounded-t-lg bg-muted" />
      ) : (
        <div className="aspect-video w-24 shrink-0 rounded-md bg-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-4 w-2/3" />
          <div className="flex items-center gap-0.5">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
          </div>
        </div>
        <Skeleton className="mt-0.5 h-3 w-1/3" />
        <Skeleton className="mt-1 h-3 w-full" />
        <Skeleton className="mt-0.5 h-3 w-5/6" />
        <div className="mt-2 flex gap-1">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
      </div>
    </Card>
  );
}

interface BookmarkCardProps {
  bookmark: BookmarkWithTags;
  layout: Layout;
  onOpen: (bookmark: BookmarkWithTags) => void;
  onDelete: (bookmark: BookmarkWithTags) => void;
  /** Active in the roving-focus list; defaults to true for standalone usage. */
  active?: boolean;
  /** Index within the list; used for stagger animation. */
  index?: number;
  /** Render as a semantic `<li>` inside the list's `<ul>`. */
  listItem?: boolean;
  /**
   * List keyboard navigation (arrows/Home/End/Delete). Attached to the card's
   * interactive controls — jsx-a11y requires handlers on interactive elements,
   * so the list `<ul>` itself stays handler-free.
   */
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  layout,
  onOpen,
  onDelete,
  active,
  index,
  listItem,
  onKeyDown,
}: BookmarkCardProps) {
  const title = bookmark.title ?? bookmark.url;
  const isActive = active ?? true;
  const cardIndex = index ?? 0;
  const isAnimated = typeof index === 'number' && index < 10;

  // Stable per-card handlers: the list re-renders on filter/page changes, and
  // fresh closures here would invalidate memoized rows.
  const handleOpen = useCallback(() => onOpen(bookmark), [onOpen, bookmark]);
  const handleDelete = useCallback(() => onDelete(bookmark), [onDelete, bookmark]);

  return (
    <Card
      data-bookmark-id={bookmark.id}
      data-index={cardIndex}
      render={listItem ? <li /> : undefined}
      className={cn(
        'group relative w-full overflow-hidden p-3 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring',
        layout === 'grid' ? 'h-full flex-col' : 'flex-row items-start',
        isAnimated &&
          'animate-in fade-in-0 duration-200 ease-out motion-safe:slide-in-from-bottom-1',
      )}
      style={isAnimated ? { animationDelay: `${cardIndex * 20}ms` } : undefined}
    >
      <CardThumb bookmark={bookmark} layout={layout} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1">
          <button
            type="button"
            data-title-button
            onClick={handleOpen}
            onKeyDown={onKeyDown}
            tabIndex={isActive ? 0 : -1}
            className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
          >
            <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
          </button>
          <div className="pointer-events-none flex items-center opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              tabIndex={isActive ? 0 : -1}
              onKeyDown={onKeyDown}
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
              tabIndex={isActive ? 0 : -1}
              onKeyDown={onKeyDown}
              aria-label={`Delete ${title}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {hostOf(bookmark.url)} · {formatDate(bookmark.createdAt)}
          </span>
          {bookmark.status === 'invalid' && <Badge variant="destructive">Invalid</Badge>}
        </p>
        {bookmark.description && (
          <p className="line-clamp-2 text-sm text-foreground/80">{bookmark.description}</p>
        )}
        {bookmark.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {bookmark.tags.map((tag) => (
              <TagPill key={tag.tagId} variant="outline">
                {tag.name}
              </TagPill>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
});

function getGridColumnCount(): number {
  if (typeof window === 'undefined') return 1;
  // Matches Tailwind classes: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3.
  const width = window.innerWidth;
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
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
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Keep the roving focus target valid when the item set changes.
  useEffect(() => {
    const first = items[0];
    if (!first) {
      setActiveId(null);
      return;
    }
    if (!items.some((item) => item.id === activeId)) {
      setActiveId(first.id);
    }
  }, [items, activeId]);

  const handleFocusIn = useCallback((event: React.FocusEvent<HTMLUListElement>) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-bookmark-id]');
    if (!card) return;
    const id = card.dataset.bookmarkId;
    if (id) {
      setActiveId((current) => (current === id ? current : id));
    }
  }, []);

  // List keyboard nav, attached to each card's interactive controls (title +
  // open/delete actions): handlers live on interactive elements only, so the
  // <ul> itself stays handler-free (jsx-a11y).
  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const card = event.currentTarget.closest<HTMLElement>('[data-bookmark-id]');
      if (!card) return;
      const index = Number(card.dataset.index);
      const bookmark = items[index];
      if (!Number.isFinite(index) || !bookmark) return;

      const lastIndex = items.length - 1;
      let nextIndex = index;

      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          onDelete(bookmark);
          event.preventDefault();
          return;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = lastIndex;
          break;
        case 'ArrowUp':
          nextIndex = layout === 'grid' ? index - getGridColumnCount() : index - 1;
          break;
        case 'ArrowDown':
          nextIndex = layout === 'grid' ? index + getGridColumnCount() : index + 1;
          break;
        case 'ArrowLeft':
          if (layout === 'grid') nextIndex = index - 1;
          break;
        case 'ArrowRight':
          if (layout === 'grid') nextIndex = index + 1;
          break;
        default:
          return;
      }

      nextIndex = Math.max(0, Math.min(lastIndex, nextIndex));
      const nextBookmark = items[nextIndex];
      if (nextIndex === index || !nextBookmark) return;
      const nextCard = listRef.current
        ?.querySelectorAll<HTMLElement>('[data-bookmark-id]')
        [nextIndex];
      const nextTitle = nextCard?.querySelector<HTMLButtonElement>('[data-title-button]');
      if (nextTitle) {
        nextTitle.focus();
        setActiveId(nextBookmark.id);
        event.preventDefault();
      }
    },
    [items, layout, onDelete],
  );

  if (loading) {
    const skeletons = Array.from({ length: 6 }, (_, index) => (
      <CardSkeleton key={index} layout={layout} />
    ));
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
    <ul
      ref={listRef}
      aria-label="Bookmarks"
      onFocusCapture={handleFocusIn}
      className={cn(
        'list-none',
        layout === 'grid'
          ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
          : 'flex flex-col gap-2',
      )}
    >
      {items.map((bookmark, index) => (
        <BookmarkCard
          key={bookmark.id}
          bookmark={bookmark}
          layout={layout}
          index={index}
          active={activeId === bookmark.id}
          listItem
          onOpen={onOpen}
          onDelete={onDelete}
          onKeyDown={handleCardKeyDown}
        />
      ))}
    </ul>
  );
}
