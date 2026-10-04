"use client";

import type { CategoryNode, Tag } from '@al-yo-bo/shared';
import type { AutocompleteRootChangeEventDetails } from '@base-ui/react/autocomplete';
import {
  ClockIcon,
  FolderIcon,
  SearchIcon,
  TagIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from '@/components/ui/command';
import { flattenCategoryTree, type CategoryOption } from '@/lib/categories';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The nested tree; flattened to `dev ▸ web` path options for jumping. */
  categories: CategoryNode[];
  tags: Tag[];
  recentQueries: string[];
  onSearch: (query: string) => void;
  onJumpToCategory: (id: string) => void;
  onJumpToTag: (id: string) => void;
}

const MAX_GROUP_ITEMS = 8;

function matchesTerm(name: string, term: string): boolean {
  return name.toLowerCase().includes(term.toLowerCase());
}

interface ActionItemProps {
  value: string;
  onClick: () => void;
  icon: React.ElementType;
  children: ReactNode;
}

function ActionItem({ value, onClick, icon: Icon, children }: ActionItemProps) {
  return (
    <CommandItem value={value} onClick={onClick}>
      <Icon className="mr-2 size-4 shrink-0" />
      {children}
    </CommandItem>
  );
}

interface SearchActionItemProps {
  term: string;
  onSearch: (term: string) => void;
}

function SearchActionItem({ term, onSearch }: SearchActionItemProps) {
  const handleClick = useCallback(() => onSearch(term), [onSearch, term]);

  return (
    <ActionItem value="search" onClick={handleClick} icon={SearchIcon}>
      <span className="truncate">Search bookmarks for “{term}”</span>
      <CommandShortcut>↵</CommandShortcut>
    </ActionItem>
  );
}

interface RecentSearchItemProps {
  query: string;
  onSearch: (query: string) => void;
}

function RecentSearchItem({ query, onSearch }: RecentSearchItemProps) {
  const handleClick = useCallback(() => onSearch(query), [onSearch, query]);

  return (
    <ActionItem value={`recent:${query}`} onClick={handleClick} icon={ClockIcon}>
      <span className="truncate">{query}</span>
    </ActionItem>
  );
}

interface CategoryItemProps {
  category: CategoryOption;
  onJump: (id: string) => void;
}

function CategoryItem({ category, onJump }: CategoryItemProps) {
  const handleClick = useCallback(() => onJump(category.id), [onJump, category.id]);

  return (
    <ActionItem value={`category:${category.id}`} onClick={handleClick} icon={FolderIcon}>
      <span className="truncate">{category.path}</span>
    </ActionItem>
  );
}

interface TagItemProps {
  tag: Tag;
  onJump: (id: string) => void;
}

function TagItem({ tag, onJump }: TagItemProps) {
  const handleClick = useCallback(() => onJump(tag.id), [onJump, tag.id]);

  return (
    <ActionItem value={`tag:${tag.id}`} onClick={handleClick} icon={TagIcon}>
      <span className="truncate">{tag.name}</span>
    </ActionItem>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  categories,
  tags,
  recentQueries,
  onSearch,
  onJumpToCategory,
  onJumpToTag,
}: CommandPaletteProps): ReactElement {
  const [inputValue, setInputValue] = useState('');

  const term = inputValue.trim();
  const hasTerm = term.length > 0;

  const categoryOptions = useMemo(() => flattenCategoryTree(categories), [categories]);
  const filteredCategories = useMemo(
    () =>
      categoryOptions
        .filter((option) => matchesTerm(option.path, term))
        .slice(0, MAX_GROUP_ITEMS),
    [categoryOptions, term],
  );

  const filteredTags = useMemo(
    () =>
      tags
        .filter((tag) => matchesTerm(tag.name, term))
        .slice(0, MAX_GROUP_ITEMS),
    [tags, term],
  );

  const handleSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        return;
      }
      onSearch(trimmed);
      onOpenChange(false);
      setInputValue('');
    },
    [onSearch, onOpenChange],
  );

  const handleCategory = useCallback(
    (id: string) => {
      onJumpToCategory(id);
      onOpenChange(false);
      setInputValue('');
    },
    [onJumpToCategory, onOpenChange],
  );

  const handleTag = useCallback(
    (id: string) => {
      onJumpToTag(id);
      onOpenChange(false);
      setInputValue('');
    },
    [onJumpToTag, onOpenChange],
  );

  const handleValueChange = useCallback(
    (value: string, details: AutocompleteRootChangeEventDetails) => {
      // In a command palette the items are actions, not selectable values. Only
      // typing and clear events should mutate the input; item selection is handled
      // by each CommandItem's onClick so the palette can close and route the action.
      if (details.reason === 'input-change' || details.reason === 'input-clear') {
        setInputValue(value);
      }
    },
    [],
  );

  const showRecents = !hasTerm && recentQueries.length > 0;
  const showCategories = filteredCategories.length > 0;
  const showTags = filteredTags.length > 0;
  const showEmpty = hasTerm && !showCategories && !showTags;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup className="max-h-[min(32rem,80vh)] duration-300">
        <CommandPanel>
          <Command value={inputValue} onValueChange={handleValueChange} mode="none">
            <CommandInput placeholder="Search bookmarks, categories, tags…" />
            <CommandList>
              {hasTerm && (
                <CommandGroup>
                  <CommandGroupLabel>Search</CommandGroupLabel>
                  <SearchActionItem term={term} onSearch={handleSearch} />
                </CommandGroup>
              )}

              {showRecents && (
                <CommandGroup>
                  <CommandGroupLabel>Recent searches</CommandGroupLabel>
                  {recentQueries.map((query) => (
                    <RecentSearchItem key={`recent:${query}`} query={query} onSearch={handleSearch} />
                  ))}
                </CommandGroup>
              )}

              {showCategories && (
                <CommandGroup>
                  <CommandGroupLabel>Categories</CommandGroupLabel>
                  {filteredCategories.map((category) => (
                    <CategoryItem key={`category:${category.id}`} category={category} onJump={handleCategory} />
                  ))}
                </CommandGroup>
              )}

              {showTags && (
                <CommandGroup>
                  <CommandGroupLabel>Tags</CommandGroupLabel>
                  {filteredTags.map((tag) => (
                    <TagItem key={`tag:${tag.id}`} tag={tag} onJump={handleTag} />
                  ))}
                </CommandGroup>
              )}

              {showEmpty && (
                <CommandEmpty className="py-8 text-center">
                  <p className="text-muted-foreground">No categories or tags match “{term}”.</p>
                  <p className="mt-1 text-xs text-muted-foreground/72">
                    Press Enter to search bookmarks instead.
                  </p>
                </CommandEmpty>
              )}

              {!hasTerm && !showRecents && !showCategories && !showTags && (
                <CommandEmpty className="py-8 text-center text-muted-foreground">
                  Type a few letters to find categories and tags.
                </CommandEmpty>
              )}
            </CommandList>
          </Command>
        </CommandPanel>
        <CommandFooter>
          <span className="flex items-center gap-2">
            <kbd className="rounded border px-1.5 py-0.5 font-sans text-[10px]">↑↓</kbd>
            <span>to navigate</span>
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border px-1.5 py-0.5 font-sans text-[10px]">↵</kbd>
            <span>to select</span>
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border px-1.5 py-0.5 font-sans text-[10px]">esc</kbd>
            <span>to close</span>
          </span>
        </CommandFooter>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
