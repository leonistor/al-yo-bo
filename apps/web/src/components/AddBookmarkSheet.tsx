import { useMutation } from '@tanstack/react-query';
import type { CategoryNode } from '@al-yo-bo/shared';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { categoryOptionItems, flattenCategoryTree } from '@/lib/categories';
import { Button } from '@/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { createBookmark } from '@/lib/client';

interface AddBookmarkSheetProps {
  open: boolean;
  categories: CategoryNode[];
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface AddInputProps {
  id: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}

function AddInput({ id, value, onChange, placeholder }: AddInputProps) {
  const render = useMemo(
    () => <Input id={id} value={value} onChange={onChange} placeholder={placeholder} />,
    [id, value, onChange, placeholder],
  );

  return <FieldControl render={render} />;
}

interface AddTextareaProps {
  id: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

function AddTextarea({ id, value, onChange }: AddTextareaProps) {
  const render = useMemo(
    () => <Textarea id={id} value={value} onChange={onChange} />,
    [id, value, onChange],
  );

  return <FieldControl render={render} />;
}

interface AddCategorySelectProps {
  categories: CategoryNode[];
  value: string;
  onValueChange: (value: string) => void;
}

function AddCategorySelect({ categories, value, onValueChange }: AddCategorySelectProps) {
  // Options flatten to `dev ▸ web` path labels — names are only sibling-unique.
  const options = useMemo(() => flattenCategoryTree(categories), [categories]);
  const items = useMemo(
    () => ({ none: 'No category', ...categoryOptionItems(options) }),
    [options],
  );

  const handleValueChange = useCallback(
    (v: string | null) => onValueChange(v ?? 'none'),
    [onValueChange],
  );

  return (
    <Select items={items} value={value} onValueChange={handleValueChange}>
      <SelectTrigger id="add-category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No category</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.path}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AddBookmarkSheet({
  open,
  categories,
  onOpenChange,
  onCreated,
}: AddBookmarkSheetProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('none');

  const createMutation = useMutation({
    mutationFn: () =>
      createBookmark({
        url: url.trim(),
        title: title.trim() || null,
        description: description.trim() || null,
        categoryId: categoryId === 'none' ? null : categoryId,
      }),
    onSuccess: () => {
      toast.success('Bookmark saved');
      setUrl('');
      setTitle('');
      setDescription('');
      setCategoryId('none');
      onCreated();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save bookmark');
    },
  });

  const handleUrlChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.target.value),
    [],
  );

  const handleTitleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value),
    [],
  );

  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(event.target.value),
    [],
  );

  const closeSelf = useCallback(() => onOpenChange(false), [onOpenChange]);
  const handleSave = useCallback(() => createMutation.mutate(), [createMutation]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-none gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Add bookmark</SheetTitle>
          <SheetDescription>Save a URL with an optional note and category.</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          <Field>
            <FieldLabel>URL</FieldLabel>
            <AddInput
              id="add-url"
              value={url}
              onChange={handleUrlChange}
              placeholder="https://"
            />
          </Field>
          <Field>
            <FieldLabel>Title</FieldLabel>
            <AddInput id="add-title" value={title} onChange={handleTitleChange} />
          </Field>
          <Field>
            {/* htmlFor is explicit: base-ui's generated id loses to our stable
                DOM id on a plain-textarea render, leaving a dangling for. */}
            <FieldLabel htmlFor="add-description">Note</FieldLabel>
            <AddTextarea
              id="add-description"
              value={description}
              onChange={handleDescriptionChange}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-category">Category</FieldLabel>
            <AddCategorySelect
              categories={categories}
              value={categoryId}
              onValueChange={setCategoryId}
            />
          </Field>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={closeSelf}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={createMutation.isPending || url.trim() === ''}
          >
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
