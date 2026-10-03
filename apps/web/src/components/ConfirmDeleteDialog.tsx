import type * as React from 'react';

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ConfirmDeleteDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  /** Short list of consequences rendered below the description. */
  impact?: string[];
  confirmLabel?: string;
  onConfirm: () => void;
  /** Optional trigger element for uncontrolled usage (base-ui render prop). */
  trigger?: React.ReactElement;
  children?: React.ReactNode;
}

/**
 * The single destructive-confirmation dialog. Accepts a controlled open state
 * or an uncontrolled trigger. Impact lines communicate consequences before the
 * user commits.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  confirmLabel = 'Delete',
  onConfirm,
  trigger,
  children,
}: ConfirmDeleteDialogProps) {
  const dialog = (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {impact && impact.length > 0 && (
          <ul className="mt-2 list-disc pl-4 text-left text-sm text-muted-foreground">
            {impact.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose className={cn(buttonVariants({ variant: 'outline' }))}>
          Cancel
        </AlertDialogClose>
        <AlertDialogClose
          onClick={onConfirm}
          className={cn(buttonVariants({ variant: 'destructive' }))}
        >
          {confirmLabel}
        </AlertDialogClose>
      </AlertDialogFooter>
    </AlertDialogContent>
  );

  if (trigger) {
    return (
      <AlertDialog>
        <AlertDialogTrigger render={trigger}>{children}</AlertDialogTrigger>
        {dialog}
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {dialog}
    </AlertDialog>
  );
}
