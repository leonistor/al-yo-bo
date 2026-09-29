import { useState } from 'react';
import { toast } from 'sonner';

import type { Category } from '@al-yo-bo/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { createCategory, createTag } from '@/lib/client';

interface VocabDialogProps {
  open: boolean;
  categories: Category[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function VocabDialog({ open, categories, onOpenChange, onChanged }: VocabDialogProps) {
  const [categoryName, setCategoryName] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagCategoryId, setTagCategoryId] = useState('none');

  async function addCategory() {
    try {
      await createCategory({ name: categoryName.trim() });
      toast.success('Category created');
      setCategoryName('');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create category');
    }
  }

  async function addTag() {
    try {
      await createTag({
        name: tagName.trim(),
        categoryId: tagCategoryId === 'none' ? null : tagCategoryId,
      });
      toast.success('Tag created');
      setTagName('');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create tag');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Categories &amp; tags</DialogTitle>
          <DialogDescription>
            Tags form the classification vocabulary. New tags are active and can be assigned right
            away.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-category">New category</Label>
            <div className="flex gap-2">
              <Input
                id="new-category"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="e.g. Research"
              />
              <Button onClick={addCategory} disabled={categoryName.trim() === ''}>
                Create
              </Button>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-tag">New tag</Label>
            <div className="flex gap-2">
              <Input
                id="new-tag"
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="e.g. accessibility"
              />
              <Select value={tagCategoryId} onValueChange={setTagCategoryId}>
                <SelectTrigger className="w-40">
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
              <Button onClick={addTag} disabled={tagName.trim() === ''}>
                Create
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
