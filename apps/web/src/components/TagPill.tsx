import { cva, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import { type ComponentProps, type MouseEvent, type ReactNode, useCallback } from 'react';

import { cn } from '@/lib/utils';

const tagPillVariants = cva(
  'inline-flex items-center gap-1 h-5 px-2 rounded-full border text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        // Default clickable filter pill; hover feedback only when interactive.
        outline: 'border-border text-foreground',
        selected: 'border-primary bg-primary text-primary-foreground',
        removable: 'border-transparent bg-secondary text-secondary-foreground',
        static: 'border-transparent bg-secondary text-secondary-foreground',
      },
      size: {
        sm: '',
        md: 'h-6 px-2.5 text-sm',
        lg: 'h-7 px-3 text-sm',
      },
      interactive: {
        // Coarse-pointer hit slop (same pattern as ui/button): an after
        // pseudo-element grows the tappable area to >= 44px tall without
        // changing the resting 20px visual. Horizontal slop stays ~8px.
        true: 'relative cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3.5',
        false: '',
      },
    },
    compoundVariants: [{ variant: 'outline', interactive: true, className: 'hover:bg-accent' }],
    defaultVariants: {
      variant: 'outline',
      size: 'sm',
      interactive: false,
    },
  },
);

export interface TagPillProps extends Omit<ComponentProps<'span'>, 'onClick' | 'ref'> {
  /** Tag name. */
  children: ReactNode;
  /** Accessible name for the remove button when children are not plain text. */
  name?: string;
  /** Optional count rendered inside the pill (sidebar tag groups). */
  count?: number;
  /** Makes the pill clickable (filters by tag). */
  onClick?: () => void;
  /** Adds a trailing remove affordance; implies the `removable` variant. */
  onRemove?: () => void;
  size?: VariantProps<typeof tagPillVariants>['size'];
  variant?: VariantProps<typeof tagPillVariants>['variant'];
}

/**
 * The single tag visual (DESIGN.md §TagPill): one pill for rows, cards,
 * sidebar, detail sheet, import preview, and chat tool results. Interactive
 * pills render as `<button>`; `removable` pills render as a `<span>` wrapping a
 * real remove `<button>` (nesting a button inside a button would be invalid).
 */
export function TagPill({
  children,
  count,
  name,
  onClick,
  onRemove,
  size,
  variant,
  className,
  ...props
}: TagPillProps) {
  const isRemovable = onRemove !== undefined;
  const isInteractive = onClick !== undefined && !isRemovable;
  const resolvedVariant = variant ?? (isRemovable ? 'removable' : 'outline');

  const handleRemove = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onRemove?.();
    },
    [onRemove],
  );

  const classes = cn(
    tagPillVariants({ variant: resolvedVariant, size, interactive: isInteractive }),
    className,
  );

  // The count must track the pill's fill: muted-foreground disappears on an
  // inverted primary surface and reads too dim on a secondary fill, so dim the
  // matching foreground instead.
  const countClass =
    resolvedVariant === 'selected'
      ? 'text-primary-foreground/80'
      : resolvedVariant === 'removable' || resolvedVariant === 'static'
        ? 'text-secondary-foreground/70'
        : 'text-muted-foreground';

  const content = (
    <>
      <span className="truncate">{children}</span>
      {count !== undefined && (
        <span className={cn(countClass, 'tabular-nums')}>{count}</span>
      )}
      {isRemovable && (
        <button
          type="button"
          aria-label={`Remove ${name ?? (typeof children === 'string' ? children : 'tag')}`}
          onClick={handleRemove}
          className="relative -mr-0.5 inline-flex size-3.5 cursor-pointer items-center justify-center rounded-full text-current/70 transition-colors hover:bg-foreground/10 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-4"
        >
          <XIcon className="size-3" aria-hidden />
        </button>
      )}
    </>
  );

  if (isInteractive) {
    return (
      <button type="button" onClick={onClick} className={classes} {...props}>
        {content}
      </button>
    );
  }

  return (
    <span className={classes} {...props}>
      {content}
    </span>
  );
}
