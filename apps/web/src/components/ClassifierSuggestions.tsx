import type { ReviewCandidate } from '@al-yo-bo/shared';
import { CheckIcon, Settings2Icon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

interface ClassifierSuggestionsProps {
  candidates: ReviewCandidate[];
  loading: boolean;
  onAccept: (candidate: ReviewCandidate) => void;
}

/**
 * Classifier suggestions below the auto-assign threshold (ARCHITECTURE §7).
 * Vocabulary no longer enters a `proposed` state — the importer creates it
 * active on commit, and the classifier votes only on existing tags — so the
 * review queue is reduced to this below-threshold list.
 */
export function ClassifierSuggestions({
  candidates,
  loading,
  onAccept,
}: ClassifierSuggestionsProps) {
  // One in-flight action at a time: disables the row's buttons so a slow
  // mutation can't be double-submitted (toasts report the outcome).
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function run(key: string, action: () => void) {
    setPendingKey(key);
    try {
      await action();
    } finally {
      setPendingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Settings2Icon />
          </EmptyMedia>
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>
            Classifier suggestions below the auto-assign threshold appear here. Accepting one writes
            a user-sourced assignment that the classifier can never overwrite.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Classifier suggestions</h2>
      {candidates.map((candidate) => {
        const key = `candidate:${candidate.bookmarkId}:${candidate.tagId}`;
        const pending = pendingKey === key;
        return (
          <div
            key={key}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {candidate.bookmarkTitle ?? candidate.bookmarkUrl}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {candidate.bookmarkUrl}
              </span>
            </div>
            <Badge variant="outline">{candidate.tagName}</Badge>
            <span className="text-xs text-muted-foreground">
              {Math.round(candidate.probability * 100)}%
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={pendingKey !== null}
              aria-busy={pending}
              onClick={() => run(key, () => onAccept(candidate))}
            >
              {pending ? <Spinner className="size-3" /> : <CheckIcon data-icon="inline-start" />}
              Accept
            </Button>
          </div>
        );
      })}
    </div>
  );
}
