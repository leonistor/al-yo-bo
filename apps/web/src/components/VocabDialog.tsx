import type { Category, Section } from '@al-yo-bo/shared';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

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
import { createCategory, createSection, createTag } from '@/lib/client';

interface VocabDialogProps {
  open: boolean;
  categories: Category[];
  sections: Section[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function VocabDialog({
  open,
  categories,
  sections,
  onOpenChange,
  onChanged,
}: VocabDialogProps) {
  const [sectionName, setSectionName] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [categorySectionId, setCategorySectionId] = useState('none');
  const [tagName, setTagName] = useState('');
  const [tagCategoryId, setTagCategoryId] = useState('none');

  const addSection = useCallback(async () => {
    try {
      await createSection({ name: sectionName.trim() });
      toast.success('Section created');
      setSectionName('');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create section');
    }
  }, [sectionName, onChanged]);

  const addCategory = useCallback(async () => {
    try {
      await createCategory({
        name: categoryName.trim(),
        sectionId: categorySectionId === 'none' ? null : categorySectionId,
      });
      toast.success('Category created');
      setCategoryName('');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create category');
    }
  }, [categoryName, categorySectionId, onChanged]);

  const addTag = useCallback(async () => {
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
  }, [tagName, tagCategoryId, onChanged]);

  const handleSectionNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setSectionName(event.target.value),
    [],
  );

  const handleCategoryNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setCategoryName(event.target.value),
    [],
  );

  const handleTagNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setTagName(event.target.value),
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sections, categories &amp; tags</DialogTitle>
          <DialogDescription>
            Sections group categories; tags form the classification vocabulary. New entries are
            active and can be used right away.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-section">New section</Label>
            <div className="flex gap-2">
              <Input
                id="new-section"
                value={sectionName}
                onChange={handleSectionNameChange}
                placeholder="e.g. AI"
              />
              <Button onClick={addSection} disabled={sectionName.trim() === ''}>
                Create
              </Button>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-category">New category</Label>
            <div className="flex gap-2">
              <Input
                id="new-category"
                value={categoryName}
                onChange={handleCategoryNameChange}
                placeholder="e.g. dev"
              />
              <Select value={categorySectionId} onValueChange={setCategorySectionId}>
                <SelectTrigger className="w-36">
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
                onChange={handleTagNameChange}
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
