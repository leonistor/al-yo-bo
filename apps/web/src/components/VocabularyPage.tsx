import { useMutation } from '@tanstack/react-query';
import type { Category, Section } from '@al-yo-bo/shared';
import { useCallback, useMemo, useState } from 'react';
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

  const sectionMutation = useMutation({
    mutationFn: () => createSection({ name: sectionName.trim() }),
    onSuccess: () => {
      toast.success('Section created');
      setSectionName('');
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create section');
    },
  });

  const categoryMutation = useMutation({
    mutationFn: () =>
      createCategory({
        name: categoryName.trim(),
        sectionId: categorySectionId === 'none' ? null : categorySectionId,
      }),
    onSuccess: () => {
      toast.success('Category created');
      setCategoryName('');
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create category');
    },
  });

  const tagMutation = useMutation({
    mutationFn: () =>
      createTag({
        name: tagName.trim(),
        categoryId: tagCategoryId === 'none' ? null : tagCategoryId,
      }),
    onSuccess: () => {
      toast.success('Tag created');
      setTagName('');
      onChanged();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create tag');
    },
  });

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

  const sectionItems = useMemo(
    () => ({
      none: 'No section',
      ...Object.fromEntries(sections.map((section) => [section.id, section.name])),
    }),
    [sections],
  );

  const categoryItems = useMemo(
    () => ({
      none: 'Global scope',
      ...Object.fromEntries(categories.map((category) => [category.id, category.name])),
    }),
    [categories],
  );

  const handleCreateSection = useCallback(
    () => sectionMutation.mutate(),
    [sectionMutation],
  );
  const handleCreateCategory = useCallback(
    () => categoryMutation.mutate(),
    [categoryMutation],
  );
  const handleCreateTag = useCallback(() => tagMutation.mutate(), [tagMutation]);

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
            <VocabInput
              id="new-section"
              value={sectionName}
              onChange={handleSectionNameChange}
              placeholder="e.g. AI"
            />
            <Button
              onClick={handleCreateSection}
              disabled={sectionName.trim() === '' || sectionMutation.isPending}
            >
              Create
            </Button>
          </FieldItem>
        </Field>

        <Separator />

        <Field>
          <FieldLabel htmlFor="new-category">New category</FieldLabel>
          <FieldItem className="w-full gap-2">
            <VocabInput
              id="new-category"
              value={categoryName}
              onChange={handleCategoryNameChange}
              placeholder="e.g. dev"
            />
            <VocabSelect
              // items registers value→label pairs so SelectValue renders the
              // section name, not the raw id.
              items={sectionItems}
              value={categorySectionId}
              onValueChange={setCategorySectionId}
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
              onClick={handleCreateCategory}
              disabled={categoryName.trim() === '' || categoryMutation.isPending}
            >
              Create
            </Button>
          </FieldItem>
        </Field>

        <Separator />

        <Field>
          <FieldLabel htmlFor="new-tag">New tag</FieldLabel>
          <FieldItem className="w-full gap-2">
            <VocabInput
              id="new-tag"
              value={tagName}
              onChange={handleTagNameChange}
              placeholder="e.g. accessibility"
            />
            <VocabSelect
              // items registers value→label pairs so SelectValue renders the
              // category name, not the raw id.
              items={categoryItems}
              value={tagCategoryId}
              onValueChange={setTagCategoryId}
              triggerClassName="w-40"
            >
              <SelectItem value="none">Global scope</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </VocabSelect>
            <Button
              onClick={handleCreateTag}
              disabled={tagName.trim() === '' || tagMutation.isPending}
            >
              Create
            </Button>
          </FieldItem>
        </Field>
      </div>
    </div>
  );
}
