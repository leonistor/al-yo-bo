import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface CollapsibleSectionProps {
  title: string;
  /** Optional right-aligned count (sidebar groups). */
  count?: number;
  /** Controlled open state — the caller persists it (e.g. `ayb:sidebar:sections`). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

/**
 * The single collapsible group (DESIGN.md §CollapsibleSection) built on the
 * base-ui collapsible wrappers. Controlled so the sidebar can persist which
 * sections are open; reused for Sections, category groups, and the Tags group.
 */
export function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
  className,
}: CollapsibleSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={className}>
      <CollapsibleTrigger className="flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {count !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[starting-style]:h-0 data-[ending-style]:h-0 motion-reduce:transition-none">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
