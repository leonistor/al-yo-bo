import { useCallback } from 'react';

import { TagPill } from '@/components/TagPill';

interface FilterTagPillProps {
  /** Tag identifier passed back to onToggle. */
  id: string;
  /** Display label. */
  name: string;
  /** Optional count rendered inside the pill (sidebar tag groups). */
  count?: number;
  /** Whether this tag is the active filter. */
  selected: boolean;
  /** Called when the pill is clicked; if omitted the pill is non-interactive. */
  onToggle?: (id: string) => void;
}

/**
 * The single interactive tag-filter wrapper used everywhere a tag can be
 * toggled as a filter: sidebar tag list and bookmark card tag rows.
 * Pixel-identical to the previous inline wrappers; keeps the click handler
 * stable inside memoized parents.
 */
export function FilterTagPill({ id, name, count, selected, onToggle }: FilterTagPillProps) {
  const handleClick = useCallback(() => onToggle?.(id), [onToggle, id]);

  return (
    <TagPill
      variant={selected ? 'selected' : 'outline'}
      count={count}
      onClick={onToggle ? handleClick : undefined}
    >
      {name}
    </TagPill>
  );
}
