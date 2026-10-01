import { XIcon } from 'lucide-react';
import { memo } from 'react';

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
          onCheckedChange={(checked) => onChange(row.key, { included: checked === true })}
          aria-label={row.included ? 'Exclude from import' : 'Include in import'}
        />
        <Input
          value={row.title}
          onChange={(event) => onChange(row.key, { title: event.target.value })}
          placeholder="Untitled"
          aria-label="Title"
          className={cn(fieldClass, 'min-w-0 flex-1 font-medium')}
          disabled={!row.included}
        />
        <Input
          value={row.priority}
          onChange={(event) => onChange(row.key, { priority: event.target.value })}
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
          onClick={() => onRemove(row.key)}
        >
          <XIcon />
        </Button>
      </div>

      <span className="truncate pl-8 font-mono text-xs text-muted-foreground" title={row.url}>
        {row.url}
      </span>

      <Input
        value={row.description}
        onChange={(event) => onChange(row.key, { description: event.target.value })}
        placeholder="Description"
        aria-label="Description"
        className={cn(fieldClass, 'ml-7 text-muted-foreground')}
        disabled={!row.included}
      />

      <div className="flex flex-col gap-1 pl-7 sm:flex-row">
        <Input
          value={row.category}
          onChange={(event) => onChange(row.key, { category: event.target.value })}
          placeholder="Category"
          aria-label="Category"
          className={cn(fieldClass, 'sm:w-40')}
          disabled={!row.included}
        />
        <Input
          value={row.tagsText}
          onChange={(event) => onChange(row.key, { tagsText: event.target.value })}
          placeholder="tags, comma, separated"
          aria-label="Tags"
          className={cn(fieldClass, 'min-w-0 flex-1')}
          disabled={!row.included}
        />
      </div>
    </div>
  );
});
