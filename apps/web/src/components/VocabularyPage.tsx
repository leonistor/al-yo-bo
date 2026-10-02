import type { Category, Section } from '@al-yo-bo/shared';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field, FieldControl, FieldItem, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { createCategory, createSection, createTag } from '@/lib/client';

interface VocabularyPageProps {
  categories: Category[];
  sections: Section[];
  onChanged: () => void;
}

export function VocabularyPage({ categories, sections, onChanged }: VocabularyPageProps) {
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
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Vocabulary</h1>
        <p className="text-sm text-muted-foreground">
          Sections group categories; tags form the classification vocabulary. New entries are
          active and can be used right away.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="new-section">New section</FieldLabel>
          <FieldItem className="w-full gap-2">
            <FieldControl
              render={
                <Input
                  id="new-section"
                  value={sectionName}
                  onChange={handleSectionNameChange}
                  placeholder="e.g. AI"
                />
              }
            />
            <Button onClick={addSection} disabled={sectionName.trim() === ''}>
              Create
            </Button>
          </FieldItem>
        </Field>

        <Separator />

        <Field>
          <FieldLabel htmlFor="new-category">New category</FieldLabel>
          <FieldItem className="w-full gap-2">
            <FieldControl
              render={
                <Input
                  id="new-category"
                  value={categoryName}
                  onChange={handleCategoryNameChange}
                  placeholder="e.g. dev"
                />
              }
            />
            <Select
              // items registers value→label pairs so SelectValue renders the
              // section name, not the raw id.
              items={{
                none: 'No section',
                ...Object.fromEntries(sections.map((section) => [section.id, section.name])),
              }}
              value={categorySectionId}
              onValueChange={(v) => setCategorySectionId(v ?? 'none')}
            >
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
          </FieldItem>
        </Field>

        <Separator />

        <Field>
          <FieldLabel htmlFor="new-tag">New tag</FieldLabel>
          <FieldItem className="w-full gap-2">
            <FieldControl
              render={
                <Input
                  id="new-tag"
                  value={tagName}
                  onChange={handleTagNameChange}
                  placeholder="e.g. accessibility"
                />
              }
            />
            <Select
              // items registers value→label pairs so SelectValue renders the
              // category name, not the raw id.
              items={{
                none: 'Global scope',
                ...Object.fromEntries(categories.map((category) => [category.id, category.name])),
              }}
              value={tagCategoryId}
              onValueChange={(v) => setTagCategoryId(v ?? 'none')}
            >
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
          </FieldItem>
        </Field>
      </div>
    </div>
  );
}
