import { LayoutGridIcon, ListIcon, RefreshCwIcon } from 'lucide-react';

import type { BookmarkSort } from '@al-yo-bo/shared';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Layout } from '@/lib/useLayout';

interface ResultsToolbarProps {
  total: number;
  loading: boolean;
  sort: BookmarkSort;
  direction: 'asc' | 'desc';
  layout: Layout;
  onSortChange: (sort: BookmarkSort) => void;
  onDirectionChange: (direction: 'asc' | 'desc') => void;
  onLayoutChange: (layout: Layout) => void;
  onRefresh: () => void;
}

export function ResultsToolbar({
  total,
  loading,
  sort,
  direction,
  layout,
  onSortChange,
  onDirectionChange,
  onLayoutChange,
  onRefresh,
}: ResultsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {total} {total === 1 ? 'result' : 'results'}
        {loading && ' · updating…'}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select value={sort} onValueChange={(value) => onSortChange(value as BookmarkSort)}>
          <SelectTrigger className="w-32 sm:w-36" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at">Newest first</SelectItem>
            <SelectItem value="updated_at">Recently updated</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={direction}
          onValueChange={(value) => onDirectionChange(value as 'asc' | 'desc')}
        >
          <SelectTrigger className="w-28" aria-label="Sort direction">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Descending</SelectItem>
            <SelectItem value="asc">Ascending</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center rounded-lg border border-border">
          <Button
            variant={layout === 'list' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="List view"
            aria-pressed={layout === 'list'}
            onClick={() => onLayoutChange('list')}
          >
            <ListIcon />
          </Button>
          <Button
            variant={layout === 'grid' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Grid view"
            aria-pressed={layout === 'grid'}
            onClick={() => onLayoutChange('grid')}
          >
            <LayoutGridIcon />
          </Button>
        </div>

        <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={onRefresh}>
          <RefreshCwIcon />
        </Button>
      </div>
    </div>
  );
}
