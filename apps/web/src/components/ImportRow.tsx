import { XIcon } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';

import { TagPill } from '@/components/TagPill';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Editable state for one extracted bookmark. Text fields stay as strings while
 * the user edits (empty string = null on commit); conversion back to
 * `ImportedBookmark` happens once, in the page's commit handler. The category
 * path is kept as its array form (`["dev","web","2024"]`) — the wire shape —
 * and rendered/edited as an `a / b / c` text field with a breadcrumb preview.
 */
export interface ImportRowState {
  /** Stable client-side key (not a bookmark id — nothing is persisted yet). */
  key: string;
  included: boolean;
  url: string;
  title: string;
  description: string;
  /** Ancestor chain from the root, e.g. `["dev", "web", "2024"]` (v2 path grammar). */
  categoryPath: string[];
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
 * A single editable extracted-bookmark row rendered as a table row. Memoized so
 * editing one field doesn't re-render the whole list — the parent hands out
 * stable callbacks and rows only change identity when their own state changes.
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

  const handleCategoryPathChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      // `/` separates levels in the input; `▸` (rendered below) is display-only.
      const path = event.target.value
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '');
      onChange(row.key, { categoryPath: path });
    },
    [onChange, row.key],
  );

  const handleTagsChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(row.key, { tagsText: event.target.value }),
    [onChange, row.key],
  );

  const handleRemove = useCallback(() => onRemove(row.key), [onRemove, row.key]);

  // Read-only preview of what the comma-separated field will become on commit,
  // deduped so identical tags (and React keys) stay stable.
  const parsedTags = Array.from(
    new Set(
      row.tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
    ),
  );

  return (
    <TableRow
      className={cn('transition-opacity', !row.included && 'opacity-50')}
      data-included={row.included}
    >
      <TableCell className="align-top">
        <Checkbox
          checked={row.included}
          onCheckedChange={toggleIncluded}
          aria-label={row.included ? 'Exclude from import' : 'Include in import'}
        />
      </TableCell>

      <TableCell className="min-w-[16rem] whitespace-normal align-top">
        <div className="flex flex-col gap-1">
          <Input
            value={row.title}
            onChange={handleTitleChange}
            placeholder="Untitled"
            aria-label="Title"
            className={cn(fieldClass, 'font-medium')}
            disabled={!row.included}
          />
          <span className="truncate font-mono text-xs text-muted-foreground" title={row.url}>
            {row.url}
          </span>
          <Input
            value={row.description}
            onChange={handleDescriptionChange}
            placeholder="Description"
            aria-label="Description"
            className={cn(fieldClass, 'text-muted-foreground')}
            disabled={!row.included}
          />
        </div>
      </TableCell>

      <TableCell className="min-w-[8rem] align-top">
        <Input
          value={row.categoryPath.join(' / ')}
          onChange={handleCategoryPathChange}
          placeholder="dev / web"
          aria-label="Category path"
          className={fieldClass}
          disabled={!row.included}
        />
        {row.categoryPath.length > 0 && (
          <p className="mt-1 truncate text-xs text-muted-foreground" title={row.categoryPath.join(' ▸ ')}>
            {row.categoryPath.join(' ▸ ')}
          </p>
        )}
      </TableCell>

      <TableCell className="w-12 text-center align-top">
        <Input
          value={row.priority}
          onChange={handlePriorityChange}
          placeholder="—"
          aria-label="Priority"
          inputMode="numeric"
          className={cn(fieldClass, 'text-center')}
          disabled={!row.included}
        />
      </TableCell>

      <TableCell className="min-w-[12rem] w-full align-top">
        <Input
          value={row.tagsText}
          onChange={handleTagsChange}
          placeholder="tags, comma, separated"
          aria-label="Tags"
          className={fieldClass}
          disabled={!row.included}
        />
        {parsedTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {parsedTags.map((tag) => (
              <TagPill key={tag} variant="static">
                {tag}
              </TagPill>
            ))}
          </div>
        )}
      </TableCell>

      <TableCell className="w-px align-top">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label="Remove row"
          onClick={handleRemove}
        >
          <XIcon />
        </Button>
      </TableCell>
    </TableRow>
  );
});
