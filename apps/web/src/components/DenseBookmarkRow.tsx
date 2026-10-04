import type { BookmarkWithTags } from '@al-yo-bo/shared';
import { ExternalLinkIcon, Trash2Icon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';

import { BookmarkThumb } from '@/components/BookmarkThumb';
import { RowActions, type RowAction } from '@/components/RowActions';
import { Card } from '@/components/ui/card';
import { hostOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Stable <li> element for semantic list rendering; avoids inline JSX-as-prop. */
const LIST_ITEM_ELEMENT = <li />;

interface DenseBookmarkRowProps {
  bookmark: BookmarkWithTags;
  /** Primary activation (the detail sheet) — owned by the title button. */
  onOpen: (bookmark: BookmarkWithTags) => void;
  onDelete: (bookmark: BookmarkWithTags) => void;
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

/** Stable anchor wrapper for the row's external-link action. */
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

/**
 * Compact dense row for the `compact` layout: small thumbnail, title, host
 * link, and a hover-revealed action cluster — the single-line counterpart of
 * `BookmarkCard`. Description and tag pills are consciously omitted (they
 * live in the detail sheet), as is the Invalid badge (invalid bookmarks stay
 * fully represented in the list/grid layouts).
 *
 * Same interaction model as `DenseBookmarkCard`: the title button is the
 * row's primary keyboard control (`data-row-focus`), the thumbnail is a
 * mouse-only click affordance, and the host link opens the URL in a new tab.
 */
export const DenseBookmarkRow = memo(function DenseBookmarkRow({
  bookmark,
  onOpen,
  onDelete,
  active,
  index,
  listItem,
  onKeyDown,
}: DenseBookmarkRowProps) {
  const title = bookmark.title ?? bookmark.url;
  const isActive = active ?? true;
  const rowIndex = index ?? 0;
  const isAnimated = typeof index === 'number' && index < 10;

  // Stable per-row handlers: the list re-renders on filter/page changes, and
  // fresh closures here would invalidate memoized rows.
  const handleOpen = useCallback(() => onOpen(bookmark), [onOpen, bookmark]);
  const handleDelete = useCallback(() => onDelete(bookmark), [onDelete, bookmark]);

  const externalLinkRender = useMemo(
    () => <ExternalLinkAnchor url={bookmark.url} title={title} />,
    [bookmark.url, title],
  );
  const animationStyle = useMemo(
    () => (isAnimated ? { animationDelay: `${rowIndex * 20}ms` } : undefined),
    [isAnimated, rowIndex],
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
      data-index={rowIndex}
      render={listItem ? LIST_ITEM_ELEMENT : undefined}
      className={cn(
        'group relative w-full flex-row items-center gap-2 p-2 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring',
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
        className="aspect-video w-16 rounded-md"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <button
          type="button"
          data-title-button
          data-row-focus
          onClick={handleOpen}
          onKeyDown={onKeyDown}
          tabIndex={isActive ? 0 : -1}
          className="min-w-0 cursor-pointer text-left focus-visible:outline-none"
        >
          <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
        </button>
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-primary transition-colors duration-150 hover:text-primary/80"
        >
          <span className="truncate">{hostOf(bookmark.url)}</span>
          <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
        </a>
      </div>
      <RowActions actions={actions} active={isActive} onKeyDown={onKeyDown} />
    </Card>
  );
});
