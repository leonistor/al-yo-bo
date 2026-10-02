import { LayoutGridIcon, ListIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback } from 'react';

import type { BookmarkListStatus, BookmarkSort } from '@al-yo-bo/shared';

import { Badge } from '@/components/ui/badge';
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
  status: BookmarkListStatus;
  /** Total invalid bookmarks from aggregates, shown on the Invalid option. */
  invalidCount: number;
  sort: BookmarkSort;
  direction: 'asc' | 'desc';
  layout: Layout;
  onStatusChange: (status: BookmarkListStatus) => void;
  onSortChange: (sort: BookmarkSort) => void;
  onDirectionChange: (direction: 'asc' | 'desc') => void;
  onLayoutChange: (layout: Layout) => void;
  onRefresh: () => void;
}

export function ResultsToolbar({
  total,
  loading,
  status,
  invalidCount,
  sort,
  direction,
  layout,
  onStatusChange,
  onSortChange,
  onDirectionChange,
  onLayoutChange,
  onRefresh,
}: ResultsToolbarProps) {
  const selectActive = useCallback(() => onStatusChange('active'), [onStatusChange]);
  const selectInvalid = useCallback(() => onStatusChange('invalid'), [onStatusChange]);

  const handleSortChange = useCallback(
    (value: string | null) => {
      if (value !== null) onSortChange(value as BookmarkSort);
    },
    [onSortChange],
  );

  const handleDirectionChange = useCallback(
    (value: string | null) => {
      if (value !== null) onDirectionChange(value as 'asc' | 'desc');
    },
    [onDirectionChange],
  );

  const selectListLayout = useCallback(() => onLayoutChange('list'), [onLayoutChange]);
  const selectGridLayout = useCallback(() => onLayoutChange('grid'), [onLayoutChange]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {total} {total === 1 ? 'result' : 'results'}
        {loading && ' · updating…'}
      </span>

      {/* Active/Invalid state filter; same segmented pattern as the layout toggle. */}
      <div className="flex items-center rounded-lg border border-border">
        <Button
          variant={status === 'active' ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={status === 'active'}
          onClick={selectActive}
        >
          Active
        </Button>
        <Button
          variant={status === 'invalid' ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={status === 'invalid'}
          onClick={selectInvalid}
        >
          Invalid
          <Badge variant="secondary" className="ml-1">
            {invalidCount}
          </Badge>
        </Button>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select value={sort} onValueChange={handleSortChange}>
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
          onValueChange={handleDirectionChange}
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
            onClick={selectListLayout}
          >
            <ListIcon />
          </Button>
          <Button
            variant={layout === 'grid' ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Grid view"
            aria-pressed={layout === 'grid'}
            onClick={selectGridLayout}
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
