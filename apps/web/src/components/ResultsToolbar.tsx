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

/** Sort options fold direction in (DESIGN.md §Results toolbar). */
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'created_at:asc', label: 'Oldest first' },
  { value: 'updated_at:desc', label: 'Recently updated' },
  { value: 'title:asc', label: 'Title A–Z' },
  { value: 'title:desc', label: 'Title Z–A' },
];

function isBookmarkSort(value: string): value is BookmarkSort {
  return value === 'created_at' || value === 'updated_at' || value === 'title';
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
      if (value === null) {
        return;
      }
      const [nextSort, nextDirection] = value.split(':');
      if (nextSort === undefined || nextDirection === undefined) {
        return;
      }
      if (!isBookmarkSort(nextSort)) {
        return;
      }
      if (nextDirection !== 'asc' && nextDirection !== 'desc') {
        return;
      }
      onSortChange(nextSort);
      onDirectionChange(nextDirection);
    },
    [onSortChange, onDirectionChange],
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
        <Select value={`${sort}:${direction}`} onValueChange={handleSortChange}>
          <SelectTrigger className="w-36 sm:w-40" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
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
