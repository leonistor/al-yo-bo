import { useCallback } from 'react';

import { TagPill, type TagPillProps } from '@/components/TagPill';

interface FilterTagPillProps {
  /** Tag identifier passed back to onToggle. */
  id: string;
  /** Display label. */
  name: string;
  /** Optional count rendered inside the pill (sidebar tag groups). */
  count?: number;
  /** Whether this tag is the active filter. */
  selected: boolean;
  /** Pill size; the sidebar tag cloud renders at `md`. */
  size?: TagPillProps['size'];
  /** Called when the pill is clicked; if omitted the pill is non-interactive. */
  onToggle?: (id: string) => void;
}

/**
 * The single interactive tag-filter wrapper used everywhere a tag can be
 * toggled as a filter: sidebar tag list and bookmark card tag rows.
 * Pixel-identical to the previous inline wrappers; keeps the click handler
 * stable inside memoized parents.
 */
export function FilterTagPill({ id, name, count, selected, size, onToggle }: FilterTagPillProps) {
  const handleClick = useCallback(() => onToggle?.(id), [onToggle, id]);

  return (
    <TagPill
      variant={selected ? 'selected' : 'outline'}
      count={count}
      size={size}
      onClick={onToggle ? handleClick : undefined}
    >
      {name}
    </TagPill>
  );
}
