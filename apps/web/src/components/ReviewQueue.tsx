import { CheckIcon, Settings2Icon, XIcon } from 'lucide-react';

import type { ReviewCandidate, Tag } from '@al-yo-bo/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

interface ReviewQueueProps {
  proposed: Tag[];
  candidates: ReviewCandidate[];
  loading: boolean;
  onApprove: (tagId: string) => void;
  onReject: (tagId: string) => void;
  onAccept: (candidate: ReviewCandidate) => void;
}

export function ReviewQueue({
  proposed,
  candidates,
  loading,
  onApprove,
  onReject,
  onAccept,
}: ReviewQueueProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const isEmpty = proposed.length === 0 && candidates.length === 0;

  if (isEmpty) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Settings2Icon />
          </EmptyMedia>
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>
            When the classifier proposes tags or finds low-confidence candidates, they appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Proposed tags</h2>
        {proposed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proposed tags.</p>
        ) : (
          proposed.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card p-3"
            >
              <Badge variant="secondary">{tag.name}</Badge>
              <span className="text-xs text-muted-foreground">
                Approve to allow auto-assignment, or reject to deprecate.
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => onApprove(tag.id)}>
                  <CheckIcon data-icon="inline-start" />
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => onReject(tag.id)}>
                  <XIcon data-icon="inline-start" />
                  Reject
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Below-threshold candidates</h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No candidates.</p>
        ) : (
          candidates.map((candidate) => (
            <div
              key={`${candidate.bookmarkId}:${candidate.tagId}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {candidate.bookmarkTitle ?? candidate.bookmarkUrl}
                </span>
                <span className="truncate text-xs text-muted-foreground">{candidate.bookmarkUrl}</span>
              </div>
              <Badge variant="outline">{candidate.tagName}</Badge>
              <span className="text-xs text-muted-foreground">
                {Math.round(candidate.probability * 100)}%
              </span>
              <Button size="sm" className="ml-auto" onClick={() => onAccept(candidate)}>
                Accept
              </Button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
