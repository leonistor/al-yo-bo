import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Aggregates, Category, Section, Tag } from '@al-yo-bo/shared';
import {
  ArchiveIcon,
  CheckIcon,
  FolderIcon,
  FolderTreeIcon,
  PencilIcon,
  TagsIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInlineEdit } from '@/hooks/useInlineEdit';
import { useListKeyboardNav } from '@/hooks/use-list-keyboard-nav';
import {
  createCategory,
  createSection,
  createTag,
  deleteCategory,
  deleteSection,
  deleteTag,
  setTagStatus,
  updateCategory,
  updateSection,
  updateTag,
} from '@/lib/client';
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

interface VocabSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  items: Record<string, string>;
  triggerClassName?: string;
  children: React.ReactNode;
}

/** Field-wrapped select with stable items and a stable value handler. */
function VocabSelect({
  value,
  onValueChange,
  items,
  triggerClassName,
  children,
}: VocabSelectProps) {
  const handleValueChange = useCallback(
    (v: string | null) => onValueChange(v ?? 'none'),
    [onValueChange],
  );

  return (
    <Select items={items} value={value} onValueChange={handleValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
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
  categories: Category[];
  sections: Section[];
  aggregates: Aggregates | null;
  tagsLoading?: boolean;
  categoriesLoading?: boolean;
  sectionsLoading?: boolean;
  onChanged: () => void;
}

/** Filter input shared by all three tabs. */
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
function VocabEmpty({ icon: Icon, title, description }: { icon: typeof TagsIcon; title: string; description: string }) {
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

interface TagRowProps {
  tag: Tag;
  index: number;
  categories: Category[];
  categoryMap: Map<string, Category>;
  bookmarkCount: number;
  active: boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onChanged: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

function TagRow({
  tag,
  index,
  categories,
  categoryMap,
  bookmarkCount,
  active,
  onKeyDown,
  onChanged,
  queryClient,
}: TagRowProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const categoryItems = useMemo(
    () => ({
      none: 'Global scope',
      ...Object.fromEntries(categories.map((category) => [category.id, category.name])),
    }),
    [categories],
  );

  const updateMutation = useMutation({
    mutationFn: async (patch: { name: string; categoryId: string | null }) =>
      updateTag(tag.id, { name: patch.name, categoryId: patch.categoryId }),
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
    () => ({ name: tag.name, categoryId: tag.categoryId ?? 'none' }),
    [tag.name, tag.categoryId],
  );
  const inline = useInlineEdit(inlineValue, async (draft) => {
    await updateMutation.mutateAsync({
      name: draft.name.trim(),
      categoryId: draft.categoryId === 'none' ? null : draft.categoryId,
    });
  });

  const { setDraft } = inline;

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, name: event.target.value })),
    [setDraft],
  );
  const handleCategoryChange = useCallback(
    (value: string | null) => setDraft((prev) => ({ ...prev, categoryId: value ?? 'none' })),
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
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {inline.editing ? (
            <Select
              value={inline.draft.categoryId}
              onValueChange={handleCategoryChange}
              items={categoryItems}
            >
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Global scope</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="truncate">
              {tag.categoryId ? categoryMap.get(tag.categoryId)?.name ?? 'Unknown category' : 'Global scope'}
            </span>
          )}
          {tag.description && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{tag.description}</span>
            </>
          )}
        </div>
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

interface CategoryRowProps {
  category: Category;
  index: number;
  sections: Section[];
  sectionMap: Map<string, Section>;
  tagCount: number;
  bookmarkCount: number;
  active: boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onChanged: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

function CategoryRow({
  category,
  index,
  sections,
  sectionMap,
  tagCount,
  bookmarkCount,
  active,
  onKeyDown,
  onChanged,
  queryClient,
}: CategoryRowProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const sectionItems = useMemo(
    () => ({
      none: 'No section',
      ...Object.fromEntries(sections.map((section) => [section.id, section.name])),
    }),
    [sections],
  );

  const updateMutation = useMutation({
    mutationFn: async (patch: { name: string; sectionId: string | null }) =>
      updateCategory(category.id, { name: patch.name, sectionId: patch.sectionId }),
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
    mutationFn: async () => deleteCategory(category.id),
    onSuccess: () => {
      toast.success('Category deleted');
      invalidateVocab(queryClient);
      onChanged();
      setDeleteOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete category');
    },
  });

  const inlineValue = useMemo(
    () => ({ name: category.name, sectionId: category.sectionId ?? 'none' }),
    [category.name, category.sectionId],
  );
  const inline = useInlineEdit(inlineValue, async (draft) => {
    await updateMutation.mutateAsync({
      name: draft.name.trim(),
      sectionId: draft.sectionId === 'none' ? null : draft.sectionId,
    });
  });

  const { setDraft } = inline;

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, name: event.target.value })),
    [setDraft],
  );
  const handleSectionChange = useCallback(
    (value: string | null) => setDraft((prev) => ({ ...prev, sectionId: value ?? 'none' })),
    [setDraft],
  );

  const categoryImpact = useMemo(
    () => [
      `${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'} become uncategorized`,
      `${tagCount} tag${tagCount === 1 ? '' : 's'} lose their category`,
    ],
    [bookmarkCount, tagCount],
  );

  const handleDeleteConfirm = useCallback(() => deleteMutation.mutate(), [deleteMutation]);

  const actions: RowAction[] = useMemo(
    () => [
      {
        id: 'edit',
        icon: <PencilIcon />,
        label: `Edit ${category.name}`,
        onClick: inline.startEdit,
      },
      {
        id: 'delete',
        icon: <Trash2Icon />,
        label: `Delete ${category.name}`,
        onClick: () => setDeleteOpen(true),
        destructive: true,
      },
    ],
    [category, inline.startEdit],
  );

  return (
    <EditableRow asListItem data-item-id={category.id} data-index={index}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
            onKeyDown={onKeyDown}
            tabIndex={active ? 0 : -1}
            data-row-focus
            className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
          >
            <span className="truncate text-sm font-medium">{category.name}</span>
          </button>
        )}
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {inline.editing ? (
            <Select
              value={inline.draft.sectionId}
              onValueChange={handleSectionChange}
              items={sectionItems}
            >
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No section</SelectItem>
                {sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="truncate">
              {category.sectionId
                ? sectionMap.get(category.sectionId)?.name ?? 'Unknown section'
                : 'No section'}
            </span>
          )}
          {tagCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{tagCount} tag{tagCount === 1 ? '' : 's'}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {inline.pending ? (
          <Spinner className="size-4" />
        ) : (
          <RowActions actions={actions} visibleCount={1} active={active} onKeyDown={onKeyDown} />
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete category “${category.name}”?`}
        description="This removes the category from the vocabulary."
        impact={categoryImpact}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />
    </EditableRow>
  );
}

interface SectionRowProps {
  section: Section;
  index: number;
  categoryCount: number;
  active: boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onChanged: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

function SectionRow({
  section,
  index,
  categoryCount,
  active,
  onKeyDown,
  onChanged,
  queryClient,
}: SectionRowProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (name: string) => updateSection(section.id, { name: name.trim() }),
    onSuccess: () => {
      toast.success('Section updated');
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update section');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteSection(section.id),
    onSuccess: () => {
      toast.success('Section deleted');
      invalidateVocab(queryClient);
      onChanged();
      setDeleteOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete section');
    },
  });

  const inline = useInlineEdit(section.name, async (name) => {
    await updateMutation.mutateAsync(name);
  });

  const { setDraft } = inline;

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [setDraft],
  );

  const sectionImpact = useMemo(
    () => [`${categoryCount} categor${categoryCount === 1 ? 'y becomes' : 'ies become'} ungrouped`],
    [categoryCount],
  );

  const handleDeleteConfirm = useCallback(() => deleteMutation.mutate(), [deleteMutation]);

  const actions: RowAction[] = useMemo(
    () => [
      {
        id: 'edit',
        icon: <PencilIcon />,
        label: `Edit ${section.name}`,
        onClick: inline.startEdit,
      },
      {
        id: 'delete',
        icon: <Trash2Icon />,
        label: `Delete ${section.name}`,
        onClick: () => setDeleteOpen(true),
        destructive: true,
      },
    ],
    [section, inline.startEdit],
  );

  return (
    <EditableRow asListItem data-item-id={section.id} data-index={index}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {inline.editing ? (
          <InlineEditInput
            editing={inline.editing}
            value={inline.draft}
            onChange={handleNameChange}
            onKeyDown={inline.handleKeyDown}
            placeholder="Section name"
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
            <span className="truncate text-sm font-medium">{section.name}</span>
          </button>
        )}
        <div className="text-xs text-muted-foreground">
          {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {inline.pending ? (
          <Spinner className="size-4" />
        ) : (
          <RowActions actions={actions} visibleCount={1} active={active} onKeyDown={onKeyDown} />
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete section “${section.name}”?`}
        description="This removes the section from the vocabulary."
        impact={sectionImpact}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />
    </EditableRow>
  );
}

function invalidateVocab(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
  void queryClient.invalidateQueries({ queryKey: queryKeys.sections });
  void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
}

interface TagPanelProps {
  tags: Tag[];
  categories: Category[];
  aggregates: Aggregates | null;
  loading: boolean;
  onChanged: () => void;
}

function TagPanel({ tags, categories, aggregates, loading, onChanged }: TagPanelProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('none');
  const listRef = useRef<HTMLUListElement | null>(null);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

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
    mutationFn: async () =>
      createTag({ name: name.trim(), categoryId: categoryId === 'none' ? null : categoryId }),
    onSuccess: () => {
      toast.success('Tag created');
      setName('');
      setCategoryId('none');
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

  const categoryItems = useMemo(
    () => ({
      none: 'Global scope',
      ...Object.fromEntries(categories.map((category) => [category.id, category.name])),
    }),
    [categories],
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
          <VocabSelect
            items={categoryItems}
            value={categoryId}
            onValueChange={setCategoryId}
            triggerClassName="w-40"
          >
            <SelectItem value="none">Global scope</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </VocabSelect>
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
            categories={categories}
            categoryMap={categoryMap}
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

interface CategoryPanelProps {
  categories: Category[];
  sections: Section[];
  tags: Tag[];
  aggregates: Aggregates | null;
  loading: boolean;
  onChanged: () => void;
}

function CategoryPanel({
  categories,
  sections,
  tags,
  aggregates,
  loading,
  onChanged,
}: CategoryPanelProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [sectionId, setSectionId] = useState('none');
  const listRef = useRef<HTMLUListElement | null>(null);

  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const filtered = useMemo(
    () =>
      categories
        .filter((category) => category.name.toLowerCase().includes(filter.toLowerCase()))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [categories, filter],
  );

  const bookmarkCounts = useMemo(
    () => new Map(aggregates?.categories.map((c) => [c.id, c.count]) ?? []),
    [aggregates],
  );
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tag of tags) {
      if (tag.categoryId) {
        counts.set(tag.categoryId, (counts.get(tag.categoryId) ?? 0) + 1);
      }
    }
    return counts;
  }, [tags]);

  const createMutation = useMutation({
    mutationFn: async () =>
      createCategory({ name: name.trim(), sectionId: sectionId === 'none' ? null : sectionId }),
    onSuccess: () => {
      toast.success('Category created');
      setName('');
      setSectionId('none');
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

  const sectionItems = useMemo(
    () => ({
      none: 'No section',
      ...Object.fromEntries(sections.map((section) => [section.id, section.name])),
    }),
    [sections],
  );

  const { activeId, handleFocusIn, handleKeyDown } = useListKeyboardNav({
    items: filtered,
    getId: (category) => category.id,
    listRef,
    mode: 'list',
    focusSelector: '[data-row-focus]',
  });

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="new-category">New category</FieldLabel>
        <FieldItem className="w-full gap-2">
          <VocabInput
            id="new-category"
            value={name}
            onChange={handleNameChange}
            placeholder="e.g. dev"
          />
          <VocabSelect
            items={sectionItems}
            value={sectionId}
            onValueChange={setSectionId}
            triggerClassName="w-36"
          >
            <SelectItem value="none">No section</SelectItem>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.name}
              </SelectItem>
            ))}
          </VocabSelect>
          <Button
            onClick={handleCreate}
            disabled={name.trim() === '' || createMutation.isPending}
          >
            Create
          </Button>
        </FieldItem>
      </Field>

      <FilterInput value={filter} onChange={setFilter} />

      <ul
        ref={listRef}
        aria-label="Categories"
        onFocusCapture={handleFocusIn}
        className="flex flex-col gap-2"
      >
        {filtered.map((category, index) => (
          <CategoryRow
            key={category.id}
            category={category}
            index={index}
            sections={sections}
            sectionMap={sectionMap}
            tagCount={tagCounts.get(category.id) ?? 0}
            bookmarkCount={bookmarkCounts.get(category.id) ?? 0}
            active={activeId === category.id}
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
          icon={FolderIcon}
          title={filter ? `No categories match "${filter}"` : 'No categories yet'}
          description={
            filter
              ? 'Try a different filter term.'
              : 'Create a category above to group your bookmarks.'
          }
        />
      ) : null}
    </div>
  );
}

interface SectionPanelProps {
  sections: Section[];
  categories: Category[];
  loading: boolean;
  onChanged: () => void;
}

function SectionPanel({ sections, categories, loading, onChanged }: SectionPanelProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(
    () =>
      sections
        .filter((section) => section.name.toLowerCase().includes(filter.toLowerCase()))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [sections, filter],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) {
      if (category.sectionId) {
        counts.set(category.sectionId, (counts.get(category.sectionId) ?? 0) + 1);
      }
    }
    return counts;
  }, [categories]);

  const createMutation = useMutation({
    mutationFn: async () => createSection({ name: name.trim() }),
    onSuccess: () => {
      toast.success('Section created');
      setName('');
      invalidateVocab(queryClient);
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create section');
    },
  });

  const handleCreate = useCallback(() => createMutation.mutate(), [createMutation]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    [],
  );

  const { activeId, handleFocusIn, handleKeyDown } = useListKeyboardNav({
    items: filtered,
    getId: (section) => section.id,
    listRef,
    mode: 'list',
    focusSelector: '[data-row-focus]',
  });

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="new-section">New section</FieldLabel>
        <FieldItem className="w-full gap-2">
          <VocabInput
            id="new-section"
            value={name}
            onChange={handleNameChange}
            placeholder="e.g. AI"
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

      <ul
        ref={listRef}
        aria-label="Sections"
        onFocusCapture={handleFocusIn}
        className="flex flex-col gap-2"
      >
        {filtered.map((section, index) => (
          <SectionRow
            key={section.id}
            section={section}
            index={index}
            categoryCount={categoryCounts.get(section.id) ?? 0}
            active={activeId === section.id}
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
          icon={FolderTreeIcon}
          title={filter ? `No sections match "${filter}"` : 'No sections yet'}
          description={
            filter
              ? 'Try a different filter term.'
              : 'Create a section above to group categories.'
          }
        />
      ) : null}
    </div>
  );
}

export function VocabularyPage({
  tags,
  categories,
  sections,
  aggregates,
  tagsLoading,
  categoriesLoading,
  sectionsLoading,
  onChanged,
}: VocabularyPageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Vocabulary</h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          {tags.length} tag{tags.length === 1 ? '' : 's'} · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {sections.length} section{sections.length === 1 ? '' : 's'}
        </span>
      </div>

      <Tabs defaultValue="tags">
        <TabsList variant="line">
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="sections">Sections</TabsTrigger>
        </TabsList>

        <TabsContent value="tags" className="mt-3">
          <TagPanel
            tags={tags}
            categories={categories}
            aggregates={aggregates}
            loading={tagsLoading ?? false}
            onChanged={onChanged}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-3">
          <CategoryPanel
            categories={categories}
            sections={sections}
            tags={tags}
            aggregates={aggregates}
            loading={categoriesLoading ?? false}
            onChanged={onChanged}
          />
        </TabsContent>

        <TabsContent value="sections" className="mt-3">
          <SectionPanel
            sections={sections}
            categories={categories}
            loading={sectionsLoading ?? false}
            onChanged={onChanged}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
