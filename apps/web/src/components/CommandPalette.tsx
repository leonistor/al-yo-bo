"use client";

import type { Category, Tag } from '@al-yo-bo/shared';
import type { AutocompleteRootChangeEventDetails } from '@base-ui/react/autocomplete';
import {
  ClockIcon,
  FolderIcon,
  SearchIcon,
  TagIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';

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

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
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

  const filteredCategories = useMemo(
    () =>
      categories
        .filter((category) => matchesTerm(category.name, term))
        .slice(0, MAX_GROUP_ITEMS),
    [categories, term],
  );

  const filteredTags = useMemo(
    () =>
      tags
        .filter((tag) => matchesTerm(tag.name, term))
        .slice(0, MAX_GROUP_ITEMS),
    [tags, term],
  );

  const handleSearch = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    onSearch(trimmed);
    onOpenChange(false);
    setInputValue('');
  };

  const handleCategory = (id: string) => {
    onJumpToCategory(id);
    onOpenChange(false);
    setInputValue('');
  };

  const handleTag = (id: string) => {
    onJumpToTag(id);
    onOpenChange(false);
    setInputValue('');
  };

  const handleValueChange = (
    value: string,
    details: AutocompleteRootChangeEventDetails,
  ) => {
    // In a command palette the items are actions, not selectable values. Only
    // typing and clear events should mutate the input; item selection is handled
    // by each CommandItem's onClick so the palette can close and route the action.
    if (details.reason === 'input-change' || details.reason === 'input-clear') {
      setInputValue(value);
    }
  };

  const showRecents = !hasTerm && recentQueries.length > 0;
  const showCategories = filteredCategories.length > 0;
  const showTags = filteredTags.length > 0;
  const showEmpty = hasTerm && !showCategories && !showTags;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup className="max-h-[min(32rem,80vh)] duration-300">
        <CommandPanel>
          <Command
            value={inputValue}
            onValueChange={handleValueChange}
            mode="none"
          >
            <CommandInput placeholder="Search bookmarks, categories, tags…" />
            <CommandList>
              {hasTerm && (
                <CommandGroup>
                  <CommandGroupLabel>Search</CommandGroupLabel>
                  <CommandItem
                    value="search"
                    onClick={() => handleSearch(term)}
                  >
                    <SearchIcon className="mr-2 size-4 shrink-0" />
                    <span className="truncate">
                      Search bookmarks for “{term}”
                    </span>
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              )}

              {showRecents && (
                <CommandGroup>
                  <CommandGroupLabel>Recent searches</CommandGroupLabel>
                  {recentQueries.map((query) => (
                    <CommandItem
                      key={`recent:${query}`}
                      value={`recent:${query}`}
                      onClick={() => handleSearch(query)}
                    >
                      <ClockIcon className="mr-2 size-4 shrink-0" />
                      <span className="truncate">{query}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {showCategories && (
                <CommandGroup>
                  <CommandGroupLabel>Categories</CommandGroupLabel>
                  {filteredCategories.map((category) => (
                    <CommandItem
                      key={`category:${category.id}`}
                      value={`category:${category.id}`}
                      onClick={() => handleCategory(category.id)}
                    >
                      <FolderIcon className="mr-2 size-4 shrink-0" />
                      <span className="truncate">{category.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {showTags && (
                <CommandGroup>
                  <CommandGroupLabel>Tags</CommandGroupLabel>
                  {filteredTags.map((tag) => (
                    <CommandItem
                      key={`tag:${tag.id}`}
                      value={`tag:${tag.id}`}
                      onClick={() => handleTag(tag.id)}
                    >
                      <TagIcon className="mr-2 size-4 shrink-0" />
                      <span className="truncate">{tag.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {showEmpty && (
                <CommandEmpty className="py-8 text-center">
                  <p className="text-muted-foreground">
                    No categories or tags match “{term}”.
                  </p>
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
            <kbd className="rounded border px-1.5 py-0.5 font-sans text-[10px]">
              ↑↓
            </kbd>
            <span>to navigate</span>
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border px-1.5 py-0.5 font-sans text-[10px]">
              ↵
            </kbd>
            <span>to select</span>
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border px-1.5 py-0.5 font-sans text-[10px]">
              esc
            </kbd>
            <span>to close</span>
          </span>
        </CommandFooter>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
