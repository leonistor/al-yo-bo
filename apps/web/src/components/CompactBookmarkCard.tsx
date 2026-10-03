import type { BookmarkWithTags } from '@al-yo-bo/shared';
import { ExternalLinkIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';

import { BookmarkThumb } from '@/components/BookmarkThumb';
import { Card } from '@/components/ui/card';
import { hostOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Stable <li> element for semantic list rendering; avoids inline JSX-as-prop. */
const LIST_ITEM_ELEMENT = <li />;

interface CompactBookmarkCardProps {
  bookmark: BookmarkWithTags;
  /** Primary activation; caller-owned: detail sheet in the library, external tab in chat. */
  onOpen: (bookmark: BookmarkWithTags) => void;
  /** Active in the roving-focus list; defaults to true for standalone usage. */
  active?: boolean;
  /** Index within the list; used for stagger animation. */
  index?: number;
  /** Render as a semantic `<li>` inside the list's `<ul>`. */
  listItem?: boolean;
  /** List keyboard navigation (arrows/Home/End/Delete). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * Thumbnail-led tile: screenshot, title, and the host's external link — the
 * dense counterpart of `BookmarkCard` (no tags, description, date, or action
 * row; everything else lives in the detail sheet). Used by the library's
 * `dense` layout and the chat tool-result surface.
 *
 * Same interaction model as `BookmarkCard`: the title button is the row's
 * primary keyboard control (`data-row-focus`), the thumbnail is a mouse-only
 * click affordance, and the host link opens the URL in a new tab.
 */
export const CompactBookmarkCard = memo(function CompactBookmarkCard({
  bookmark,
  onOpen,
  active,
  index,
  listItem,
  onKeyDown,
}: CompactBookmarkCardProps) {
  const title = bookmark.title ?? bookmark.url;
  const isActive = active ?? true;
  const cardIndex = index ?? 0;
  const isAnimated = typeof index === 'number' && index < 10;

  // Stable per-card handlers: the list re-renders on filter/page changes, and
  // fresh closures here would invalidate memoized rows.
  const handleOpen = useCallback(() => onOpen(bookmark), [onOpen, bookmark]);
  const animationStyle = useMemo(
    () => (isAnimated ? { animationDelay: `${cardIndex * 20}ms` } : undefined),
    [isAnimated, cardIndex],
  );

  return (
    <Card
      data-bookmark-id={bookmark.id}
      data-item-id={bookmark.id}
      data-index={cardIndex}
      render={listItem ? LIST_ITEM_ELEMENT : undefined}
      className={cn(
        'group relative w-full overflow-hidden p-2 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring',
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
        className="-mx-2 -mt-2 mb-2 aspect-video rounded-t-lg"
      />
      <div className="flex min-w-0 flex-col gap-1">
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
    </Card>
  );
});
