import type { BookmarkWithTags } from '@al-yo-bo/shared';
import {
  BookmarkIcon,
  ExternalLinkIcon,
  PlusIcon,
  SearchXIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';

import { BookmarkThumb } from '@/components/BookmarkThumb';
import { DenseBookmarkCard } from '@/components/DenseBookmarkCard';
import { FilterTagPill } from '@/components/FilterTagPill';
import { RowActions, type RowAction } from '@/components/RowActions';
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
import { useListKeyboardNav } from '@/hooks/use-list-keyboard-nav';
import { hostOf } from '@/lib/format';
import type { Layout } from '@/lib/useLayout';
import { cn } from '@/lib/utils';

/** Stable <li> element for semantic list rendering; avoids inline JSX-as-prop. */
const LIST_ITEM_ELEMENT = <li />;

/** Dense tile grid (DenseBookmarkCard): 2/3/4/5 columns by breakpoint. */
const DENSE_GRID_CLASSES = 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

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
  /** Active tag filter; renders the matching pill as `selected`. */
  selectedTagId?: string | null;
  /** Toggles the tag filter when a row pill is clicked. */
  onTagClick?: (tagId: string) => void;
}

/** Skeleton mirroring the real card anatomy so loading doesn't shift layout. */
function CardSkeleton({ layout }: { layout: Layout }) {
  if (layout === 'dense') {
    return (
      <Card className="w-full overflow-hidden p-2" aria-hidden>
        <div className="-mx-2 -mt-2 mb-2 aspect-video rounded-t-lg bg-muted" />
        <div className="flex min-w-0 flex-col gap-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </Card>
    );
  }
  return (
    <Card
      className={cn(
        'w-full overflow-hidden',
        layout === 'grid' ? 'h-full flex-col p-3' : 'flex-row items-start gap-2 p-3',
      )}
      aria-hidden
    >
      {layout === 'grid' ? (
        <div className="-mx-3 -mt-3 mb-0 aspect-video rounded-t-lg bg-muted" />
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
  /** Full cards render in the list/grid layouts; dense uses DenseBookmarkCard. */
  layout: Exclude<Layout, 'dense'>;
  onOpen: (bookmark: BookmarkWithTags) => void;
  onDelete: (bookmark: BookmarkWithTags) => void;
  /** Active tag filter; renders the matching pill as `selected`. */
  selectedTagId?: string | null;
  /** Toggles the tag filter when a row pill is clicked. */
  onTagClick?: (tagId: string) => void;
  /** Active in the roving-focus list; defaults to true for standalone usage. */
  active?: boolean;
  /** Index within the list; used for stagger animation. */
  index?: number;
  /** Render as a semantic `<li>` inside the list's `<ul>`. */
  listItem?: boolean;
  /** List keyboard navigation (arrows/Home/End/Delete). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

interface ExternalLinkAnchorProps {
  url: string;
  title: string;
}

/** Stable anchor wrapper for the card's external-link button. */
function ExternalLinkAnchor({ url, title }: ExternalLinkAnchorProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${title} in a new tab`}
    />
  );
}

export const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  layout,
  onOpen,
  onDelete,
  selectedTagId,
  onTagClick,
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

  const externalLinkRender = useMemo(
    () => <ExternalLinkAnchor url={bookmark.url} title={title} />,
    [bookmark.url, title],
  );
  const animationStyle = useMemo(
    () => (isAnimated ? { animationDelay: `${cardIndex * 20}ms` } : undefined),
    [isAnimated, cardIndex],
  );

  const actions = useMemo<RowAction[]>(
    () => [
      {
        id: 'open',
        icon: <ExternalLinkIcon />,
        label: `Open ${title} in a new tab`,
        render: externalLinkRender,
      },
      {
        id: 'delete',
        icon: <Trash2Icon />,
        label: `Delete ${title}`,
        onClick: handleDelete,
        destructive: true,
      },
    ],
    [title, externalLinkRender, handleDelete],
  );

  return (
    <Card
      data-bookmark-id={bookmark.id}
      data-item-id={bookmark.id}
      data-index={cardIndex}
      render={listItem ? LIST_ITEM_ELEMENT : undefined}
      className={cn(
        'group relative w-full overflow-hidden p-3 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring',
        layout === 'grid' ? 'h-full flex-col' : 'flex-row items-start gap-2',
        isAnimated &&
          'animate-in fade-in-0 duration-200 ease-out motion-safe:slide-in-from-bottom-1',
      )}
      style={animationStyle}
    >
      <BookmarkThumb
        bookmark={bookmark}
        title={title}
        onOpen={handleOpen}
        onKeyDown={onKeyDown}
        className={
          layout === 'grid'
            ? '-mx-3 -mt-3 mb-0 aspect-video rounded-t-lg'
            : 'aspect-video w-24 rounded-md'
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1">
          <button
            type="button"
            data-title-button
            data-row-focus
            onClick={handleOpen}
            onKeyDown={onKeyDown}
            tabIndex={isActive ? 0 : -1}
            className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
          >
            <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
          </button>
          <RowActions actions={actions} active={isActive} onKeyDown={onKeyDown} />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {/* The host doubles as the bookmark's external link: tinted, one step
              larger than meta text, with an explicit new-tab icon. */}
          <a
            href={bookmark.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 truncate text-sm text-primary transition-colors duration-150 hover:text-primary/80"
          >
            <span className="truncate">{hostOf(bookmark.url)}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          </a>
          {bookmark.status === 'invalid' && <Badge variant="destructive">Invalid</Badge>}
        </p>
        {bookmark.description && (
          <p className="line-clamp-2 text-sm text-foreground/80">{bookmark.description}</p>
        )}
        {bookmark.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {bookmark.tags.slice(0, 5).map((tag) => (
              <FilterTagPill
                key={tag.tagId}
                id={tag.tagId}
                name={tag.name}
                selected={selectedTagId === tag.tagId}
                onToggle={onTagClick}
              />
            ))}
            {bookmark.tags.length > 5 && (
              <TagPill
                onClick={handleOpen}
                aria-label={`Show all ${bookmark.tags.length} tags`}
              >
                +{bookmark.tags.length - 5}
              </TagPill>
            )}
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

function getDenseColumnCount(): number {
  if (typeof window === 'undefined') return 2;
  // Matches DENSE_GRID_CLASSES: grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5.
  const width = window.innerWidth;
  if (width >= 1280) return 5;
  if (width >= 1024) return 4;
  if (width >= 640) return 3;
  return 2;
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
  selectedTagId,
  onTagClick,
}: BookmarkListProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  const { activeId, handleFocusIn, handleKeyDown } = useListKeyboardNav({
    items,
    getId: (bookmark) => bookmark.id,
    listRef,
    onActivate: onOpen,
    onDelete,
    // Dense tiles navigate like the grid: column-aware arrows.
    mode: layout === 'list' ? 'list' : 'grid',
    getColumnCount: layout === 'dense' ? getDenseColumnCount : getGridColumnCount,
    focusSelector: '[data-title-button]',
  });

  if (loading) {
    const skeletons = Array.from({ length: layout === 'dense' ? 10 : 6 }, (_, index) => (
      <CardSkeleton key={index} layout={layout} />
    ));
    if (layout === 'grid') {
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{skeletons}</div>
      );
    }
    if (layout === 'dense') {
      return <div className={DENSE_GRID_CLASSES}>{skeletons}</div>;
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
        layout === 'dense'
          ? DENSE_GRID_CLASSES
          : layout === 'grid'
            ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
            : 'flex flex-col gap-2',
      )}
    >
      {items.map((bookmark, index) =>
        layout === 'dense' ? (
          <DenseBookmarkCard
            key={bookmark.id}
            bookmark={bookmark}
            index={index}
            active={activeId === bookmark.id}
            listItem
            onOpen={onOpen}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <BookmarkCard
            key={bookmark.id}
            bookmark={bookmark}
            layout={layout}
            index={index}
            active={activeId === bookmark.id}
            listItem
            onOpen={onOpen}
            onDelete={onDelete}
            selectedTagId={selectedTagId}
            onTagClick={onTagClick}
            onKeyDown={handleKeyDown}
          />
        ),
      )}
    </ul>
  );
}
