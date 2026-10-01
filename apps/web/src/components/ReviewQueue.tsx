import type { ReviewCandidate, Tag } from '@al-yo-bo/shared';
import {
  CheckIcon,
  FolderOpenIcon,
  HashIcon,
  LayersIcon,
  Settings2Icon,
  XIcon,
} from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import type { StagedBatch } from '@/lib/client';

interface ReviewQueueProps {
  proposed: Tag[];
  candidates: ReviewCandidate[];
  batches: StagedBatch[];
  loading: boolean;
  onApprove: (tagId: string) => void;
  onReject: (tagId: string) => void;
  onAccept: (candidate: ReviewCandidate) => void;
  onAcceptProposal: (batchId: string, proposalId: string, kind: string) => void;
  onRejectProposal: (batchId: string, proposalId: string, kind: string) => void;
  onCommitBatch: (batchId: string) => void;
  onDiscardBatch: (batchId: string) => void;
}

function proposalIcon(kind: string) {
  switch (kind) {
    case 'section':
      return <LayersIcon className="size-3.5" />;
    case 'category':
      return <FolderOpenIcon className="size-3.5" />;
    case 'tag':
      return <HashIcon className="size-3.5" />;
  }
}

export function ReviewQueue({
  proposed,
  candidates,
  batches,
  loading,
  onApprove,
  onReject,
  onAccept,
  onAcceptProposal,
  onRejectProposal,
  onCommitBatch,
  onDiscardBatch,
}: ReviewQueueProps) {
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

  const isEmpty = proposed.length === 0 && candidates.length === 0 && batches.length === 0;

  if (isEmpty) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Settings2Icon />
          </EmptyMedia>
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>
            When the classifier proposes tags, finds low-confidence candidates, or an import
            proposes new vocabulary, they appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Proposed vocabulary</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proposed vocabulary.</p>
        ) : (
          batches.map((batch) => (
            <div
              key={batch.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  Import{batch.file ? `: ${batch.file}` : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  {batch.bookmarkCount} bookmark{batch.bookmarkCount === 1 ? '' : 's'}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    disabled={pendingKey !== null}
                    onClick={() => run(`commit:${batch.id}`, () => onCommitBatch(batch.id))}
                  >
                    Commit import
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingKey !== null}
                    onClick={() => run(`discard:${batch.id}`, () => onDiscardBatch(batch.id))}
                  >
                    Discard
                  </Button>
                </div>
              </div>
              {batch.proposals.map((proposal) => {
                const key = `vocab:${batch.id}:${proposal.id}`;
                const pending = pendingKey === key;
                return (
                  <div
                    key={key}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2"
                  >
                    <Badge variant="secondary" className="gap-1">
                      {proposalIcon(proposal.kind)}
                      {proposal.name}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {proposal.kind} from {proposal.source} · {proposal.count} bookmark
                      {proposal.count === 1 ? '' : 's'}
                    </span>
                    <div className="ml-auto flex gap-2">
                      <Button
                        size="sm"
                        disabled={pendingKey !== null}
                        aria-busy={pending}
                        onClick={() =>
                          run(key, () => onAcceptProposal(batch.id, proposal.id, proposal.kind))
                        }
                      >
                        {pending ? (
                          <Spinner className="size-3" />
                        ) : (
                          <CheckIcon data-icon="inline-start" />
                        )}
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingKey !== null}
                        aria-busy={pendingKey === key}
                        onClick={() =>
                          run(key, () => onRejectProposal(batch.id, proposal.id, proposal.kind))
                        }
                      >
                        {pendingKey === key ? (
                          <Spinner className="size-3" />
                        ) : (
                          <XIcon data-icon="inline-start" />
                        )}
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Proposed tags</h2>
        {proposed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proposed tags.</p>
        ) : (
          proposed.map((tag) => {
            const key = `tag:${tag.id}`;
            const pending = pendingKey === key;
            return (
              <div
                key={tag.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
              >
                <Badge variant="secondary">{tag.name}</Badge>
                <span className="text-xs text-muted-foreground">
                  Approve to allow auto-assignment, or reject to deprecate.
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    disabled={pendingKey !== null}
                    aria-busy={pending}
                    onClick={() => run(key, () => onApprove(tag.id))}
                  >
                    {pending ? (
                      <Spinner className="size-3" />
                    ) : (
                      <CheckIcon data-icon="inline-start" />
                    )}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingKey !== null}
                    aria-busy={pendingKey === key}
                    onClick={() => run(key, () => onReject(tag.id))}
                  >
                    {pendingKey === key ? (
                      <Spinner className="size-3" />
                    ) : (
                      <XIcon data-icon="inline-start" />
                    )}
                    Reject
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Below-threshold candidates</h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No candidates.</p>
        ) : (
          candidates.map((candidate) => {
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
                  {pending && <Spinner className="size-3" />}
                  Accept
                </Button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
