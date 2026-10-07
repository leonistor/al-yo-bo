import type { LucideIcon } from 'lucide-react';
import { ChevronDownIcon, CombineIcon, SearchIcon, SparklesIcon, TypeIcon } from 'lucide-react';
import type { ChangeEvent, RefObject } from 'react';
import { useCallback, useMemo } from 'react';

import type { SearchMode } from '@al-yo-bo/shared';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TopbarSearchProps {
  query: string;
  mode: SearchMode;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: SearchMode) => void;
}

const MODES: { value: SearchMode; label: string; icon: LucideIcon; description: string }[] = [
  { value: 'keyword', label: 'Keyword', icon: TypeIcon, description: 'Title, URL, notes' },
  {
    value: 'semantic',
    label: 'Semantic',
    icon: SparklesIcon,
    description: 'Meaning match',
  },
  { value: 'hybrid', label: 'Hybrid', icon: CombineIcon, description: 'Both combined' },
];

interface SearchModeMenuProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}

function SearchModeMenu({ mode, onModeChange }: SearchModeMenuProps) {
  const current = useMemo(
    () => MODES.find((m) => m.value === mode) ?? MODES[0]!,
    [mode],
  );
  const CurrentIcon = current.icon;

  const trigger = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Search mode: ${current.label}`}
        title={current.label}
        className="h-7 gap-1 px-1.5 font-normal text-muted-foreground hover:text-foreground"
      >
        <CurrentIcon className="size-4 shrink-0" />
        <span className="hidden text-xs sm:inline">{current.label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-64" />
      </Button>
    ),
    [CurrentIcon, current.label],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" className="min-w-44">
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <DropdownMenuItem
              key={m.value}
              onClick={() => onModeChange(m.value)}
              className="items-start gap-2 py-1.5"
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm leading-tight">{m.label}</span>
                <span className="text-xs leading-tight text-muted-foreground">
                  {m.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopbarSearch({
  query,
  mode,
  searchRef,
  onQueryChange,
  onModeChange,
}: TopbarSearchProps) {
  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value),
    [onQueryChange],
  );

  const searchIconTrigger = useMemo(
    () => <span className="flex shrink-0 items-center text-muted-foreground" />,
    [],
  );

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 transition-shadow duration-150 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {/* The wrapper — not a separate button — is the tooltip trigger so the
          icon stays pointer-events-none and clicking still focuses the input. */}
      <Tooltip>
        <TooltipTrigger render={searchIconTrigger}>
          <SearchIcon className="pointer-events-none" />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          / focuses search · Keyword: title, URL, notes · Semantic: meaning match · Hybrid: both
          combined
        </TooltipContent>
      </Tooltip>
      <Input
        ref={searchRef}
        value={query}
        onChange={handleQueryChange}
        placeholder="Search bookmarks…  (press /)"
        aria-label="Search bookmarks"
        className="min-w-0 flex-1 border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 has-focus-visible:ring-0 dark:bg-transparent"
      />
      <SearchModeMenu mode={mode} onModeChange={onModeChange} />
    </div>
  );
}
