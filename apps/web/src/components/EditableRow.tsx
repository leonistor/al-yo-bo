import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Borderless input style used for inline-editable list rows. Keeps the row
 * readable as plain text until hover or focus draws the field border.
 */
export const editableInputClass =
  'h-7 border-transparent bg-transparent px-1 shadow-none hover:border-input focus-visible:border-input focus-visible:ring-0';

interface EditableRowProps extends React.HTMLAttributes<HTMLElement> {
  /** Render the row as a semantic list item. */
  asListItem?: boolean;
}

interface InlineEditInputProps extends React.ComponentPropsWithoutRef<typeof Input> {
  /** Focus the field when the user explicitly enters inline-edit mode. */
  editing: boolean;
}

/**
 * Input that autofocuses only when inline-edit mode is active. The focus move
 * is intentional (user pressed Edit or Enter), not a page-load trap.
 */
export function InlineEditInput({ editing, ...props }: InlineEditInputProps) {
  // eslint-disable-next-line jsx-a11y/no-autofocus
  return <Input autoFocus={editing} {...props} />;
}

/**
 * Shared row chrome for managed lists: bordered card, hover/focus surface,
 * and a data attribute for keyboard navigation.
 */
export function EditableRow({
  asListItem,
  className,
  children,
  ...props
}: EditableRowProps) {
  const classes = cn(
    'group relative flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring',
    className,
  );

  if (asListItem) {
    return (
      <li className={classes} {...props}>
        {children}
      </li>
    );
  }

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
