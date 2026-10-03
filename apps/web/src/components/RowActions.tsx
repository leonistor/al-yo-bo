import { MoreVerticalIcon } from 'lucide-react';
import { useMemo } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const rowActionsVariants = cva(
  'pointer-events-none flex items-center opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100',
  {
    variants: {
      variant: {
        default: '',
        danger: '[&_button]:text-destructive/80 [&_button]:hover:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface RowAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  /** Click handler; omit when using a polymorphic render. */
  onClick?: () => void;
  disabled?: boolean;
  /** Renders the button polymorphically (e.g. as an external anchor). */
  render?: React.ReactElement;
  destructive?: boolean;
}

interface RowActionsProps extends VariantProps<typeof rowActionsVariants> {
  actions: RowAction[];
  /** How many actions render as direct icon buttons before overflowing to a menu. */
  visibleCount?: number;
  /** Roving tabindex: active row buttons are tabbable, inactive rows are not. */
  active?: boolean;
  /** Keyboard navigation handler forwarded to every visible button. */
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  className?: string;
}

/**
 * Hover/focus-revealed action cluster used by every list row.
 * Up to `visibleCount` actions render as icon buttons; the rest collapse into
 * an overflow menu. Every control carries an aria-label.
 */
export function RowActions({
  actions,
  visibleCount = 2,
  variant,
  active = true,
  onKeyDown,
  className,
}: RowActionsProps) {
  const visible = useMemo(() => actions.slice(0, visibleCount), [actions, visibleCount]);
  const overflow = useMemo(() => actions.slice(visibleCount), [actions, visibleCount]);
  const hasOverflow = overflow.length > 0;

  const overflowTrigger = useMemo(
    () => (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="More actions"
        tabIndex={active ? 0 : -1}
        onKeyDown={onKeyDown}
      />
    ),
    [active, onKeyDown],
  );

  return (
    <div className={cn(rowActionsVariants({ variant }), className)}>
      {visible.map((action) => (
        <Button
          key={action.id}
          variant="ghost"
          size="icon-sm"
          aria-label={action.label}
          disabled={action.disabled}
          render={action.render}
          tabIndex={active ? 0 : -1}
          onKeyDown={onKeyDown}
          onClick={action.render ? undefined : action.onClick}
          className={cn(
            action.destructive &&
              'text-muted-foreground hover:text-destructive',
          )}
        >
          {action.icon}
        </Button>
      ))}

      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger render={overflowTrigger}>
            <MoreVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onClick={action.onClick}
                disabled={action.disabled}
                variant={action.destructive ? 'destructive' : 'default'}
              >
                <span className="flex items-center gap-2">
                  {action.icon}
                  {action.label}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
