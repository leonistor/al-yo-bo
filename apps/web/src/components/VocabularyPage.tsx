import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Aggregates, CategoryNode, Tag } from '@al-yo-bo/shared';
import {
  ArchiveIcon,
  CheckIcon,
  FolderPlusIcon,
  PencilIcon,
  TagsIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cva, type VariantProps } from 'class-variance-authority';

import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { EditableRow, editableInputClass, InlineEditInput } from '@/components/EditableRow';
import { RowActions, type RowAction } from '@/components/RowActions';
import { Button } from '@/components/ui/button';
import { Field, FieldControl, FieldItem, FieldLabel } from '@/components/ui/field';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCategoryDropHandler } from '@/hooks/useCategoryMutations';
import { useInlineEdit } from '@/hooks/useInlineEdit';
import { useListKeyboardNav } from '@/hooks/use-list-keyboard-nav';
import {
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  setTagStatus,
  updateCategory,
  updateTag,
} from '@/lib/client';
import { dropPositionFromEvent, isSelfOrDescendant } from '@/lib/categories';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

interface VocabInputProps {
  id: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}

/** Field-wrapped input with a memoized render prop so the parent stays stable. */
function VocabInput({ id, value, onChange, placeholder }: VocabInputProps) {
  const render = useMemo(
    () => <Input id={id} value={value} onChange={onChange} placeholder={placeholder} />,
    [id, value, onChange, placeholder],
  );

  return <FieldControl render={render} />;
}

const statusBadgeVariants = cva(
  'inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      status: {
        active: 'border-primary/20 bg-primary/10 text-primary',
        deprecated: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      status: 'active',
    },
  },
);

interface StatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  children: React.ReactNode;
}

function StatusBadge({ status, children }: StatusBadgeProps) {
  return <span className={cn(statusBadgeVariants({ status }))}>{children}</span>;
}

interface VocabularyPageProps {
  tags: Tag[];
  tree: CategoryNode[];
  aggregates: Aggregates | null;
  tagsLoading?: boolean;
  categoriesLoading?: boolean;
  onChanged: () => void;
}

/** Filter input shared by both tabs. */
function FilterInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange],
  );
  return (
    <Input
      type="search"
      placeholder="Filter by name…"
      value={value}
      onChange={handleChange}
      className="h-8"
    />
  );
}

/** Skeleton row mirroring the real row anatomy so loading doesn't shift layout. */
function VocabSkeleton() {
  return (
    <EditableRow aria-hidden>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-1/3" />
          <div className="flex items-center gap-0.5">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-3 w-2/3" />
      </div>
    </EditableRow>
  );
}

/** Empty state nudging the user back to the create form above. */
function VocabEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof TagsIcon;
  title: string;
  description: string;
}) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function invalidateVocab(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
  void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
}

interface TagRowProps {
  tag: Tag;
  index: number;
  bookmarkCount: number;
  active: boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onChanged: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

/**
 * One vocabulary tag row (MODEL.md principle 3): rename + description inline,
 * the `active ⇄ deprecated` lifecycle toggle, and a delete whose impact list
 * names the assignment and immutable-evidence loss.
 */
function TagRow({
  tag,
  index,
  bookmarkCount,
  active,
  onKeyDown,
  onChanged,
  queryClient,
}: TagRowProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (patch: { name: string; description: string | null }) =>
      updateTag(tag.id, { name: patch.name, description: patch.description }),
    onSuccess: () => {
      toast.success('Tag updated');
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update tag');
    },
  });

  const statusMutation = useMutation({
    mutationFn: async () => setTagStatus(tag.id, tag.status === 'active' ? 'deprecated' : 'active'),
    onSuccess: () => {
      toast.success(tag.status === 'active' ? 'Tag deprecated' : 'Tag reactivated');
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to change tag status');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteTag(tag.id),
    onSuccess: () => {
      toast.success('Tag deleted');
      invalidateVocab(queryClient);
      onChanged();
      setDeleteOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete tag');
    },
  });

  // Stable identity is a useInlineEdit contract: a fresh literal per render
  // would make the not-editing draft resync loop (see useInlineEdit doc).
  const inlineValue = useMemo(
    () => ({ name: tag.name, description: tag.description ?? '' }),
    [tag.name, tag.description],
  );
  const inline = useInlineEdit(inlineValue, async (draft) => {
    await updateMutation.mutateAsync({
      name: draft.name.trim(),
      description: draft.description.trim() === '' ? null : draft.description.trim(),
    });
  });

  const { setDraft } = inline;

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, name: event.target.value })),
    [setDraft],
  );
  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, description: event.target.value })),
    [setDraft],
  );

  const tagImpact = useMemo(
    () => [
      `Removes the tag from ${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'}`,
      // Deprecate-first rationale (MODEL.md): hard delete cascades away the
      // tag's immutable classification evidence — the user must see that cost.
      'Deletes all classification evidence recorded for this tag',
    ],
    [bookmarkCount],
  );

  const handleStatusClick = useCallback(() => statusMutation.mutate(), [statusMutation]);
  const handleDeleteConfirm = useCallback(() => deleteMutation.mutate(), [deleteMutation]);

  const actions: RowAction[] = useMemo(
    () => [
      {
        id: 'status',
        icon: tag.status === 'active' ? <ArchiveIcon /> : <CheckIcon />,
        label: tag.status === 'active' ? `Deprecate ${tag.name}` : `Reactivate ${tag.name}`,
        onClick: handleStatusClick,
        disabled: statusMutation.isPending,
      },
      {
        id: 'edit',
        icon: <PencilIcon />,
        label: `Edit ${tag.name}`,
        onClick: inline.startEdit,
      },
      {
        id: 'delete',
        icon: <Trash2Icon />,
        label: `Delete ${tag.name}`,
        onClick: () => setDeleteOpen(true),
        destructive: true,
      },
    ],
    [tag, handleStatusClick, statusMutation.isPending, inline.startEdit],
  );

  return (
    <EditableRow asListItem data-item-id={tag.id} data-index={index}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          {inline.editing ? (
            <InlineEditInput
              editing={inline.editing}
              value={inline.draft.name}
              onChange={handleNameChange}
              onKeyDown={inline.handleKeyDown}
              placeholder="Tag name"
              className={cn(editableInputClass, 'w-48 font-medium')}
              data-row-focus
            />
          ) : (
            <button
              type="button"
              onClick={inline.startEdit}
              onKeyDown={onKeyDown}
              tabIndex={active ? 0 : -1}
              data-row-focus
              className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
            >
              <span className="truncate text-sm font-medium">{tag.name}</span>
            </button>
          )}
          <StatusBadge status={tag.status}>{tag.status}</StatusBadge>
          {bookmarkCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{bookmarkCount}</span>
          )}
        </div>
        {inline.editing ? (
          <InlineEditInput
            editing={inline.editing}
            value={inline.draft.description}
            onChange={handleDescriptionChange}
            onKeyDown={inline.handleKeyDown}
            placeholder="Description (optional)"
            className={cn(editableInputClass, 'text-muted-foreground')}
          />
        ) : (
          tag.description && (
            <div className="text-xs text-muted-foreground">
              <span className="truncate">{tag.description}</span>
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-2">
        {inline.pending || statusMutation.isPending ? (
          <Spinner className="size-4" />
        ) : (
          <RowActions actions={actions} visibleCount={1} active={active} onKeyDown={onKeyDown} />
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete tag “${tag.name}”?`}
        description="This removes the tag from the vocabulary."
        impact={tagImpact}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />
    </EditableRow>
  );
}

interface TagPanelProps {
  tags: Tag[];
  aggregates: Aggregates | null;
  loading: boolean;
  onChanged: () => void;
}

function TagPanel({ tags, aggregates, loading, onChanged }: TagPanelProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(
    () =>
      tags
        .filter((tag) => tag.name.toLowerCase().includes(filter.toLowerCase()))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [tags, filter],
  );

  const tagCounts = useMemo(
    () => new Map(aggregates?.tags.map((t) => [t.id, t.count]) ?? []),
    [aggregates],
  );

  const createMutation = useMutation({
    mutationFn: async () => createTag({ name: name.trim() }),
    onSuccess: () => {
      toast.success('Tag created');
      setName('');
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create tag');
    },
  });

  const handleCreate = useCallback(() => createMutation.mutate(), [createMutation]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    [],
  );

  const { activeId, handleFocusIn, handleKeyDown } = useListKeyboardNav({
    items: filtered,
    getId: (tag) => tag.id,
    listRef,
    mode: 'list',
    focusSelector: '[data-row-focus]',
  });

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="new-tag">New tag</FieldLabel>
        <FieldItem className="w-full gap-2">
          <VocabInput
            id="new-tag"
            value={name}
            onChange={handleNameChange}
            placeholder="e.g. accessibility"
          />
          <Button onClick={handleCreate} disabled={name.trim() === '' || createMutation.isPending}>
            Create
          </Button>
        </FieldItem>
      </Field>

      <FilterInput value={filter} onChange={setFilter} />

      <ul
        ref={listRef}
        aria-label="Tags"
        onFocusCapture={handleFocusIn}
        className="flex flex-col gap-2"
      >
        {filtered.map((tag, index) => (
          <TagRow
            key={tag.id}
            tag={tag}
            index={index}
            bookmarkCount={tagCounts.get(tag.id) ?? 0}
            active={activeId === tag.id}
            onKeyDown={handleKeyDown}
            onChanged={onChanged}
            queryClient={queryClient}
          />
        ))}
      </ul>

      {loading ? (
        <div className="flex flex-col gap-2">
          <VocabSkeleton />
          <VocabSkeleton />
          <VocabSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <VocabEmpty
          icon={TagsIcon}
          title={filter ? `No tags match "${filter}"` : 'No tags yet'}
          description={
            filter
              ? 'Try a different filter term.'
              : 'Create a tag above to start building your classification vocabulary.'
          }
        />
      ) : null}
    </div>
  );
}

interface VocabCategoryRowProps {
  node: CategoryNode;
  depth: number;
  /** Subtree (own + descendants) bookmark count — meta line and delete impact. */
  bookmarkCount: number;
  /** Categories removed by a delete of this node (itself + descendants). */
  subtreeCategoryCount: number;
  dragId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  /** Panel-provided drop (full tree in scope): move (`into`) or sibling reorder. */
  onDropNode: (dragId: string, targetId: string, position: 'before' | 'after' | 'into') => void;
  onAddChild: (parentId: string) => void;
  onChanged: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

/**
 * One editable tree row: rename/description inline, add-child, drag
 * move/reorder (three-zone drop, same semantics as the sidebar), and a
 * delete confirm backed by client-computed subtree counts (the server
 * has no pre-delete info route; DELETE echoes the same numbers).
 */
function VocabCategoryRow({
  node,
  depth,
  bookmarkCount,
  subtreeCategoryCount,
  dragId,
  onDragStart,
  onDragEnd,
  onDropNode,
  onAddChild,
  onChanged,
  queryClient,
}: VocabCategoryRowProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hover, setHover] = useState<'before' | 'after' | 'into' | null>(null);

  const updateMutation = useMutation({
    mutationFn: async (patch: { name: string; description: string | null }) =>
      updateCategory(node.id, { name: patch.name, description: patch.description }),
    onSuccess: () => {
      toast.success('Category updated');
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update category');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteCategory(node.id),
    onSuccess: (info) => {
      toast.success(
        `Category deleted — ${info.categories} categor${info.categories === 1 ? 'y' : 'ies'} removed, ${info.bookmarks} bookmark${info.bookmarks === 1 ? '' : 's'} kept`,
      );
      invalidateVocab(queryClient);
      onChanged();
      setDeleteOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete category');
    },
  });

  const inlineValue = useMemo(
    () => ({ name: node.name, description: node.description ?? '' }),
    [node.name, node.description],
  );
  const inline = useInlineEdit(inlineValue, async (draft) => {
    await updateMutation.mutateAsync({
      name: draft.name.trim(),
      description: draft.description.trim() === '' ? null : draft.description.trim(),
    });
  });

  const { setDraft } = inline;

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, name: event.target.value })),
    [setDraft],
  );
  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, description: event.target.value })),
    [setDraft],
  );

  const categoryImpact = useMemo(
    () => [
      `${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'} become uncategorized`,
      `${subtreeCategoryCount} categor${subtreeCategoryCount === 1 ? 'y' : 'ies'} removed (children cascade)`,
    ],
    [bookmarkCount, subtreeCategoryCount],
  );

  const handleDeleteConfirm = useCallback(() => deleteMutation.mutate(), [deleteMutation]);

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.id);
      onDragStart(node.id);
    },
    [node.id, onDragStart],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!dragId || dragId === node.id) {
        return;
      }
      // Cycle guard (MODEL.md principle 2): never offer to drop a subtree
      // into itself.
      if (isSelfOrDescendant(node, dragId)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setHover(dropPositionFromEvent(event));
    },
    [dragId, node],
  );

  const handleDragLeave = useCallback(() => setHover(null), []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const position = dropPositionFromEvent(event);
      setHover(null);
      onDragEnd();
      if (!dragId || dragId === node.id) {
        return;
      }
      onDropNode(dragId, node.id, position);
    },
    [onDropNode, dragId, node, onDragEnd],
  );

  const actions: RowAction[] = useMemo(
    () => [
      {
        id: 'add-child',
        icon: <FolderPlusIcon />,
        label: `Add child under ${node.name}`,
        onClick: () => onAddChild(node.id),
      },
      {
        id: 'edit',
        icon: <PencilIcon />,
        label: `Edit ${node.name}`,
        onClick: inline.startEdit,
      },
      {
        id: 'delete',
        icon: <Trash2Icon />,
        label: `Delete ${node.name}`,
        onClick: () => setDeleteOpen(true),
        destructive: true,
      },
    ],
    [node, inline.startEdit, onAddChild],
  );

  return (
    <EditableRow
      asListItem
      data-item-id={node.id}
      className={cn(
        'relative transition-opacity',
        dragId === node.id && 'opacity-40',
        hover === 'into' && 'bg-accent/60',
      )}
    >
      {/* Reorder guide lines: 1px before/after indicators over the row edges. */}
      {hover === 'before' && (
        <span aria-hidden className="absolute inset-x-2 top-0 h-0.5 bg-primary" />
      )}
      {hover === 'after' && (
        <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />
      )}
      <div
        className="flex min-w-0 flex-1 cursor-grab flex-col gap-1"
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-center gap-2">
          {depth > 0 && (
            <span
              className="shrink-0 font-mono text-xs text-muted-foreground"
              aria-hidden
            >
              {'·'.repeat(depth)}
            </span>
          )}
          {inline.editing ? (
            <InlineEditInput
              editing={inline.editing}
              value={inline.draft.name}
              onChange={handleNameChange}
              onKeyDown={inline.handleKeyDown}
              placeholder="Category name"
              className={cn(editableInputClass, 'w-48 font-medium')}
              data-row-focus
            />
          ) : (
            <button
              type="button"
              onClick={inline.startEdit}
              tabIndex={-1}
              className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
            >
              <span className="truncate text-sm font-medium">{node.name}</span>
            </button>
          )}
          {node.children.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {node.children.length} {node.children.length === 1 ? 'child' : 'children'}
            </span>
          )}
          {bookmarkCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{bookmarkCount}</span>
          )}
        </div>
        {inline.editing ? (
          <InlineEditInput
            editing={inline.editing}
            value={inline.draft.description}
            onChange={handleDescriptionChange}
            onKeyDown={inline.handleKeyDown}
            placeholder="Description (optional)"
            className={cn(editableInputClass, 'text-muted-foreground')}
          />
        ) : (
          node.description && (
            <div className="text-xs text-muted-foreground">
              <span className="truncate">{node.description}</span>
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-2">
        {inline.pending || deleteMutation.isPending ? (
          <Spinner className="size-4" />
        ) : (
          <RowActions actions={actions} visibleCount={2} />
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete category “${node.name}”?`}
        description="This removes the category and its whole subtree from the vocabulary. Bookmarks survive uncategorized."
        impact={categoryImpact}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />
    </EditableRow>
  );
}

/** The inline "new child category" form shown under exactly one parent row. */
function NewChildForm({
  parent,
  onDone,
  onChanged,
  queryClient,
}: {
  parent: CategoryNode;
  onDone: () => void;
  onChanged: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus via ref: the attribute form trips usability lint and screen
  // readers; focusing once on mount keeps the keyboard flow intact.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => createCategory({ name: name.trim(), parentId: parent.id }),
    onSuccess: () => {
      toast.success('Category created');
      setName('');
      onDone();
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create category');
    },
  });

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    [],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && name.trim() !== '') {
        createMutation.mutate();
      }
      if (event.key === 'Escape') {
        onDone();
      }
    },
    [name, createMutation, onDone],
  );

  return (
    <div className="ml-6 flex items-center gap-2">
      <Input
        ref={inputRef}
        value={name}
        placeholder="Child category name"
        aria-label="Child category name"
        className="h-8 max-w-xs"
        onChange={handleNameChange}
        onKeyDown={handleKeyDown}
      />
      <Button
        size="sm"
        disabled={name.trim() === '' || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}

interface CategoryPanelProps {
  tree: CategoryNode[];
  aggregates: Aggregates | null;
  loading: boolean;
  onChanged: () => void;
}

/**
 * The category tree management panel (MODEL.md principle 2): unlimited-depth
 * tree with drag move/reorder, rename/description, add-child, and delete with
 * subtree-count confirmation. The filter flattens matches to path labels —
 * drag-reorder is a tree operation, so it only exists in the unfiltered view.
 */
function CategoryPanel({ tree, aggregates, loading, onChanged }: CategoryPanelProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [newChildParent, setNewChildParent] = useState<string | null>(null);

  const { handleDrop, handleDropToRoot } = useCategoryDropHandler();

  // Subtree bookmark counts from the aggregates (delete dialog + meta lines).
  const subtreeCounts = useMemo(() => {
    const direct = new Map(aggregates?.categories.map((c) => [c.id, c.count]) ?? []);
    const totals = new Map<string, number>();
    const walk = (node: CategoryNode): number => {
      let sum = direct.get(node.id) ?? 0;
      for (const child of node.children) {
        sum += walk(child);
      }
      totals.set(node.id, sum);
      return sum;
    };
    for (const node of tree) {
      walk(node);
    }
    return totals;
  }, [tree, aggregates]);

  // Subtree category counts (node + descendants) for the delete impact list.
  const subtreeSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    const walk = (node: CategoryNode): number => {
      let size = 1;
      for (const child of node.children) {
        size += walk(child);
      }
      sizes.set(node.id, size);
      return size;
    };
    for (const node of tree) {
      walk(node);
    }
    return sizes;
  }, [tree]);

  // The filter flattens the tree; matches render with their full path label.
  const matches = useMemo(() => {
    if (filter.trim() === '') {
      return null;
    }
    const needle = filter.toLowerCase();
    const found: { id: string; label: string }[] = [];
    const walk = (nodes: CategoryNode[], prefix: string) => {
      for (const node of nodes) {
        const path = prefix === '' ? node.name : `${prefix} ▸ ${node.name}`;
        if (node.name.toLowerCase().includes(needle)) {
          found.push({ id: node.id, label: path });
        }
        walk(node.children, path);
      }
    };
    walk(tree, '');
    return found;
  }, [tree, filter]);

  const createMutation = useMutation({
    mutationFn: async () => createCategory({ name: name.trim(), parentId: null }),
    onSuccess: () => {
      toast.success('Category created');
      setName('');
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create category');
    },
  });

  const handleCreate = useCallback(() => createMutation.mutate(), [createMutation]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    [],
  );

  const endDrag = useCallback(() => setDragId(null), []);

  const onDropNode = useCallback(
    (drag: string, target: string, position: 'before' | 'after' | 'into') => {
      handleDrop(tree, drag, target, position);
    },
    [handleDrop, tree],
  );

  const onDropToRootNode = useCallback(() => {
    if (dragId) {
      handleDropToRoot(tree, dragId);
    }
    endDrag();
  }, [dragId, handleDropToRoot, tree, endDrag]);

  // Recursive renderer as a named in-component function: a useCallback cannot
  // reference itself during initialization (react/immutability).
  function renderTree(nodes: CategoryNode[], depth: number): React.ReactNode {
    return nodes.map((node) => (
      <div key={node.id} className="flex flex-col gap-2">
        <VocabCategoryRow
          node={node}
          depth={depth}
          bookmarkCount={subtreeCounts.get(node.id) ?? 0}
          subtreeCategoryCount={subtreeSizes.get(node.id) ?? 1}
          dragId={dragId}
          onDragStart={setDragId}
          onDragEnd={endDrag}
          onDropNode={onDropNode}
          onAddChild={setNewChildParent}
          onChanged={onChanged}
          queryClient={queryClient}
        />
        {newChildParent === node.id && (
          <NewChildForm
            parent={node}
            onDone={() => setNewChildParent(null)}
            onChanged={onChanged}
            queryClient={queryClient}
          />
        )}
        {node.children.length > 0 && (
          <div className="ml-4 flex flex-col gap-2 border-l-2 border-border/60 pl-3">
            {renderTree(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  }

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="new-category">New root category</FieldLabel>
        <FieldItem className="w-full gap-2">
          <VocabInput
            id="new-category"
            value={name}
            onChange={handleNameChange}
            placeholder="e.g. dev"
          />
          <Button
            onClick={handleCreate}
            disabled={name.trim() === '' || createMutation.isPending}
          >
            Create
          </Button>
        </FieldItem>
      </Field>

      <FilterInput value={filter} onChange={setFilter} />

      {matches !== null ? (
        <ul aria-label="Matching categories" className="flex flex-col gap-2">
          {matches.map((match) => (
            <EditableRow key={match.id} asListItem>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{match.label}</span>
            </EditableRow>
          ))}
          {matches.length === 0 && (
            <VocabEmpty
              icon={TagsIcon}
              title={`No categories match "${filter}"`}
              description="Try a different filter term."
            />
          )}
        </ul>
      ) : (
        <div aria-label="Categories" className="flex flex-col gap-2">
          {renderTree(tree, 0)}
          {/* Root drop strip: move a nested category to the top level. A plain
              div — drag targets are not interactive controls. */}
          {dragId !== null && (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                onDropToRootNode();
              }}
              className="flex items-center justify-center rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground"
            >
              Drop to move to top level
            </div>
          )}
          {loading ? (
            <div className="flex flex-col gap-2">
              <VocabSkeleton />
              <VocabSkeleton />
            </div>
          ) : tree.length === 0 ? (
            <VocabEmpty
              icon={FolderPlusIcon}
              title="No categories yet"
              description="Create a root category above, or import a collection — the importer creates categories from headings."
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export function VocabularyPage({
  tags,
  tree,
  aggregates,
  tagsLoading,
  categoriesLoading,
  onChanged,
}: VocabularyPageProps) {
  const categoryCount = aggregates?.categories.length ?? 0;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Vocabulary</h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          {tags.length} tag{tags.length === 1 ? '' : 's'} · {categoryCount} categor
          {categoryCount === 1 ? 'y' : 'ies'}
        </span>
      </div>

      <Tabs defaultValue="categories">
        <TabsList variant="line">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-3">
          <CategoryPanel
            tree={tree}
            aggregates={aggregates}
            loading={categoriesLoading ?? false}
            onChanged={onChanged}
          />
        </TabsContent>

        <TabsContent value="tags" className="mt-3">
          <TagPanel
            tags={tags}
            aggregates={aggregates}
            loading={tagsLoading ?? false}
            onChanged={onChanged}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
