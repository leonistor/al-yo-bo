import { XIcon } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Editable state for one extracted bookmark. Text fields stay as strings while
 * the user edits (empty string = null on commit); conversion back to
 * `ImportedBookmark` happens once, in the page's commit handler.
 */
export interface ImportRowState {
  /** Stable client-side key (not a bookmark id — nothing is persisted yet). */
  key: string;
  included: boolean;
  url: string;
  title: string;
  description: string;
  category: string;
  /** Raw priority text ('' = none); validated at commit time. */
  priority: string;
  /** Comma-separated tag names; split/trimmed at commit time. */
  tagsText: string;
}

export type ImportRowPatch = Partial<Omit<ImportRowState, 'key'>>;

interface ImportRowProps {
  row: ImportRowState;
  onChange: (key: string, patch: ImportRowPatch) => void;
  onRemove: (key: string) => void;
}

// Borderless until hovered/focused: an editable list should read like a list,
// not a wall of form controls. Focus rings stay fully visible (DESIGN.md).
const fieldClass =
  'h-8 border-transparent bg-transparent px-1.5 shadow-none hover:border-input focus-visible:border-input';

/**
 * A single editable extracted-bookmark row. Memoized so editing one field
 * doesn't re-render the whole list — the parent hands out stable callbacks
 * and rows only change identity when their own state changes.
 */
export const ImportRow = memo(function ImportRow({ row, onChange, onRemove }: ImportRowProps) {
  // Per-field stable handlers: this component is memoized so editing one field
  // doesn't re-render sibling rows — new inline closures would defeat that.
  const toggleIncluded = useCallback(
    (checked: boolean | 'indeterminate') => onChange(row.key, { included: checked === true }),
    [onChange, row.key],
  );

  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(row.key, { title: event.target.value }),
    [onChange, row.key],
  );

  const handlePriorityChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(row.key, { priority: event.target.value }),
    [onChange, row.key],
  );

  const handleDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(row.key, { description: event.target.value }),
    [onChange, row.key],
  );

  const handleCategoryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(row.key, { category: event.target.value }),
    [onChange, row.key],
  );

  const handleTagsChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(row.key, { tagsText: event.target.value }),
    [onChange, row.key],
  );

  const handleRemove = useCallback(() => onRemove(row.key), [onRemove, row.key]);

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-card py-2 pr-2 pl-3 transition-opacity',
        !row.included && 'opacity-50',
      )}
      data-included={row.included}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          checked={row.included}
          onCheckedChange={toggleIncluded}
          aria-label={row.included ? 'Exclude from import' : 'Include in import'}
        />
        <Input
          value={row.title}
          onChange={handleTitleChange}
          placeholder="Untitled"
          aria-label="Title"
          className={cn(fieldClass, 'min-w-0 flex-1 font-medium')}
          disabled={!row.included}
        />
        <Input
          value={row.priority}
          onChange={handlePriorityChange}
          placeholder="—"
          aria-label="Priority"
          inputMode="numeric"
          className={cn(fieldClass, 'w-12 text-center')}
          disabled={!row.included}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label="Remove row"
          onClick={handleRemove}
        >
          <XIcon />
        </Button>
      </div>

      <span className="truncate pl-8 font-mono text-xs text-muted-foreground" title={row.url}>
        {row.url}
      </span>

      <Input
        value={row.description}
        onChange={handleDescriptionChange}
        placeholder="Description"
        aria-label="Description"
        className={cn(fieldClass, 'ml-7 text-muted-foreground')}
        disabled={!row.included}
      />

      <div className="flex flex-col gap-1 pl-7 sm:flex-row">
        <Input
          value={row.category}
          onChange={handleCategoryChange}
          placeholder="Category"
          aria-label="Category"
          className={cn(fieldClass, 'sm:w-40')}
          disabled={!row.included}
        />
        <Input
          value={row.tagsText}
          onChange={handleTagsChange}
          placeholder="tags, comma, separated"
          aria-label="Tags"
          className={cn(fieldClass, 'min-w-0 flex-1')}
          disabled={!row.included}
        />
      </div>
    </div>
  );
});
