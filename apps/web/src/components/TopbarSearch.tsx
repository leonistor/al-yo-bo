import type { LucideIcon } from 'lucide-react';
import { CombineIcon, SearchIcon, SparklesIcon, TypeIcon } from 'lucide-react';
import type { ChangeEvent, RefObject } from 'react';
import { useCallback } from 'react';

import type { SearchMode } from '@al-yo-bo/shared';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TopbarSearchProps {
  query: string;
  mode: SearchMode;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: SearchMode) => void;
}

const MODES: { value: SearchMode; label: string; icon: LucideIcon }[] = [
  { value: 'keyword', label: 'Keyword', icon: TypeIcon },
  { value: 'semantic', label: 'Semantic', icon: SparklesIcon },
  { value: 'hybrid', label: 'Hybrid', icon: CombineIcon },
];

interface ModeButtonProps {
  value: SearchMode;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onChange: (mode: SearchMode) => void;
}

function ModeButton({ value, label, icon: Icon, active, onChange }: ModeButtonProps) {
  const handleClick = useCallback(() => onChange(value), [onChange, value]);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={handleClick}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-7 sm:w-7',
        active
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function SearchModeToggle({
  mode,
  onModeChange,
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}) {
  // Fieldset gives the segmented control real group semantics (jsx-a11y prefers
  // the tag over role="group"); the resets strip the browser chrome.
  return (
    <fieldset aria-label="Search mode" className="m-0 flex items-center border-0 p-0">
      {MODES.map((m) => (
        <ModeButton
          key={m.value}
          value={m.value}
          label={m.label}
          icon={m.icon}
          active={mode === m.value}
          onChange={onModeChange}
        />
      ))}
    </fieldset>
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

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 transition-shadow duration-150 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <SearchIcon className="pointer-events-none shrink-0 text-muted-foreground" />
      <Input
        ref={searchRef}
        value={query}
        onChange={handleQueryChange}
        placeholder="Search bookmarks…  (press /)"
        aria-label="Search bookmarks"
        className="min-w-0 flex-1 border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 has-focus-visible:ring-0 dark:bg-transparent"
      />
      <SearchModeToggle mode={mode} onModeChange={onModeChange} />
    </div>
  );
}
