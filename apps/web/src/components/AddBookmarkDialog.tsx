import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { Category } from '@al-yo-bo/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldControl, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createBookmark } from '@/lib/client';

interface AddBookmarkDialogProps {
  open: boolean;
  categories: Category[];
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function AddBookmarkDialog({
  open,
  categories,
  onOpenChange,
  onCreated,
}: AddBookmarkDialogProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('none');
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setSaving(true);
    try {
      await createBookmark({
        url: url.trim(),
        title: title.trim() || null,
        description: description.trim() || null,
        categoryId: categoryId === 'none' ? null : categoryId,
      });
      toast.success('Bookmark saved');
      setUrl('');
      setTitle('');
      setDescription('');
      setCategoryId('none');
      onCreated();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save bookmark');
    } finally {
      setSaving(false);
    }
  }, [url, title, description, categoryId, onCreated, onOpenChange]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add bookmark</DialogTitle>
          <DialogDescription>Save a URL with an optional note and category.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel>URL</FieldLabel>
            <FieldControl
              render={
                <Input
                  id="add-url"
                  value={url}
                  onChange={handleUrlChange}
                  placeholder="https://"
                />
              }
            />
          </Field>
          <Field>
            <FieldLabel>Title</FieldLabel>
            <FieldControl
              render={<Input id="add-title" value={title} onChange={handleTitleChange} />}
            />
          </Field>
          <Field>
            {/* htmlFor is explicit: base-ui's generated id loses to our stable
                DOM id on a plain-textarea render, leaving a dangling for. */}
            <FieldLabel htmlFor="add-description">Note</FieldLabel>
            <FieldControl
              render={
                <Textarea
                  id="add-description"
                  value={description}
                  onChange={handleDescriptionChange}
                />
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-category">Category</FieldLabel>
            <Select
              value={categoryId}
              onValueChange={(v) => setCategoryId(v ?? 'none')}
            >
              <SelectTrigger id="add-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeSelf}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || url.trim() === ''}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
