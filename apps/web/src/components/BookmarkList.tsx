import { BookmarkIcon } from 'lucide-react';

import type { BookmarkWithTags } from '@al-yo-bo/shared';

import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, hostOf } from '@/lib/format';
import type { Layout } from '@/lib/useLayout';
import { cn } from '@/lib/utils';

interface BookmarkListProps {
  items: BookmarkWithTags[];
  loading: boolean;
  layout: Layout;
  onOpen: (bookmark: BookmarkWithTags) => void;
}

function BookmarkCard({
  bookmark,
  layout,
  onOpen,
}: {
  bookmark: BookmarkWithTags;
  layout: Layout;
  onOpen: (bookmark: BookmarkWithTags) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(bookmark)}
      className={cn(
        'group flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left text-card-foreground transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        layout === 'grid' && 'h-full',
      )}
    >
      <div className="flex items-start gap-2">
        <h3 className="truncate text-sm font-medium">{bookmark.title ?? bookmark.url}</h3>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatDate(bookmark.createdAt)}
        </span>
      </div>
      <p className="truncate text-xs text-muted-foreground">{hostOf(bookmark.url)}</p>
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
    </button>
  );
}

export function BookmarkList({ items, loading, layout, onOpen }: BookmarkListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookmarkIcon />
          </EmptyMedia>
          <EmptyTitle>No bookmarks</EmptyTitle>
          <EmptyDescription>
            Try a different search, or add and import bookmarks to fill your library.
          </EmptyDescription>
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
        <BookmarkCard key={bookmark.id} bookmark={bookmark} layout={layout} onOpen={onOpen} />
      ))}
    </div>
  );
}
