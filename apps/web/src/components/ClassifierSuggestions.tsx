import type { ReviewCandidate } from '@al-yo-bo/shared';
import { CheckIcon, Settings2Icon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';

import { EditableRow } from '@/components/EditableRow';
import { TagPill } from '@/components/TagPill';
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
import { useListKeyboardNav } from '@/hooks/use-list-keyboard-nav';

interface ClassifierSuggestionsProps {
  candidates: ReviewCandidate[];
  loading: boolean;
  onAccept: (candidate: ReviewCandidate) => void;
}

interface CandidateRowProps {
  candidate: ReviewCandidate;
  /** Stable client-side key (also used as the React key). */
  candidateKey: string;
  /** Non-null while any row has an in-flight accept (one action at a time). */
  pendingKey: string | null;
  index: number;
  active: boolean;
  onAccept: (candidate: ReviewCandidate) => void;
  onPendingChange: (key: string | null) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/** One suggestion row; owns the accept handler and its in-flight spinner. */
const CandidateRow = memo(function CandidateRow({
  candidate,
  candidateKey,
  pendingKey,
  index,
  active,
  onAccept,
  onPendingChange,
  onKeyDown,
}: CandidateRowProps) {
  const pending = pendingKey === candidateKey;

  const handleAccept = useCallback(async () => {
    onPendingChange(candidateKey);
    // `Promise.resolve` normalizes the void-typed callback so `.finally`
    // always releases the row lock (oxlint's dep analysis misreads
    // try/finally around the call as an extra dependency).
    await Promise.resolve(onAccept(candidate)).finally(() => onPendingChange(null));
  }, [candidateKey, onAccept, candidate, onPendingChange]);

  return (
    <EditableRow
      asListItem
      data-item-id={candidateKey}
      data-index={index}
      className="items-start sm:items-center"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">
          {candidate.bookmarkTitle ?? candidate.bookmarkUrl}
        </span>
        <span className="truncate text-xs text-muted-foreground">{candidate.bookmarkUrl}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:justify-end">
        <TagPill variant="static">{candidate.tagName}</TagPill>
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.round(candidate.probability * 100)}%
        </span>
      </div>
      <Button
        size="sm"
        disabled={pendingKey !== null}
        aria-busy={pending}
        onClick={handleAccept}
        onKeyDown={onKeyDown}
        tabIndex={active ? 0 : -1}
        data-row-focus
      >
        {pending ? <Spinner className="size-3" /> : <CheckIcon data-icon="inline-start" />}
        Accept
      </Button>
    </EditableRow>
  );
});

/** Skeleton mirroring the real row anatomy so loading doesn't shift layout. */
function CandidateSkeleton() {
  return (
    <EditableRow aria-hidden>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-7 w-20 rounded-md" />
    </EditableRow>
  );
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
  const listRef = useRef<HTMLUListElement | null>(null);

  const { activeId, handleFocusIn, handleKeyDown } = useListKeyboardNav({
    items: candidates,
    getId: (candidate) => `candidate:${candidate.bookmarkId}:${candidate.tagId}`,
    listRef,
    onActivate: onAccept,
    mode: 'list',
    focusSelector: '[data-row-focus]',
  });

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <CandidateSkeleton />
        <CandidateSkeleton />
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
      <ul
        ref={listRef}
        aria-label="Classifier suggestions"
        onFocusCapture={handleFocusIn}
        className="flex flex-col gap-2"
      >
        {candidates.map((candidate, index) => {
          const key = `candidate:${candidate.bookmarkId}:${candidate.tagId}`;
          return (
            <CandidateRow
              key={key}
              candidate={candidate}
              candidateKey={key}
              pendingKey={pendingKey}
              index={index}
              active={activeId === key}
              onAccept={onAccept}
              onPendingChange={setPendingKey}
              onKeyDown={handleKeyDown}
            />
          );
        })}
      </ul>
    </div>
  );
}
