import { useEffect, useState } from 'react';
import { ExternalLinkIcon, Trash2Icon, XIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { BookmarkWithTags, Category, Tag } from '@al-yo-bo/shared';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  assignTagToBookmark,
  deleteBookmark,
  removeTagFromBookmark,
  updateBookmark,
} from '@/lib/client';
import { hostOf } from '@/lib/format';

interface BookmarkDetailDialogProps {
  bookmark: BookmarkWithTags | null;
  categories: Category[];
  tags: Tag[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onDeleted: () => void;
}

export function BookmarkDetailDialog({
  bookmark,
  categories,
  tags,
  onOpenChange,
  onChanged,
  onDeleted,
}: BookmarkDetailDialogProps) {
  const [current, setCurrent] = useState<BookmarkWithTags | null>(bookmark);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('none');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCurrent(bookmark);
    setTitle(bookmark?.title ?? '');
    setDescription(bookmark?.description ?? '');
    setCategoryId(bookmark?.categoryId ?? 'none');
  }, [bookmark]);

  if (!current) {
    return null;
  }

  const availableTags = tags.filter(
    (tag) => !current.tags.some((assigned) => assigned.tagId === tag.id),
  );

  async function save() {
    setSaving(true);
    try {
      const updated = await updateBookmark(current!.id, {
        title: title.trim() || null,
        description: description.trim() || null,
        categoryId: categoryId === 'none' ? null : categoryId,
      });
      setCurrent(updated);
      toast.success('Bookmark updated');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function addTag(tagId: string) {
    try {
      const updated = await assignTagToBookmark(current!.id, tagId);
      setCurrent(updated);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign tag');
    }
  }

  async function removeTag(tagId: string) {
    try {
      await removeTagFromBookmark(current!.id, tagId);
      setCurrent({ ...current!, tags: current!.tags.filter((tag) => tag.tagId !== tagId) });
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
    }
  }

  async function remove() {
    try {
      await deleteBookmark(current!.id);
      toast.success('Bookmark deleted');
      onDeleted();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    }
  }

  return (
    <Dialog open={bookmark !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current.title ?? hostOf(current.url)}</DialogTitle>
          <DialogDescription>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {current.url}
              <ExternalLinkIcon className="size-3" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-title">Title</Label>
            <Input
              id="detail-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-description">Note</Label>
            <Textarea
              id="detail-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
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
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1">
              {current.tags.length === 0 && (
                <span className="text-xs text-muted-foreground">No tags yet.</span>
              )}
              {current.tags.map((tag) => (
                <Badge key={tag.tagId} variant="secondary" className="gap-1">
                  {tag.name}
                  {tag.source === 'user' && <span className="text-[0.65rem] opacity-70">user</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${tag.name}`}
                    onClick={() => removeTag(tag.tagId)}
                    className="ml-0.5 rounded-sm hover:text-destructive"
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            {availableTags.length > 0 && (
              <Select value="" onValueChange={addTag}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Add a tag…" />
                </SelectTrigger>
                <SelectContent>
                  {availableTags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this bookmark?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the bookmark and its tag assignments.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={save} disabled={saving}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
