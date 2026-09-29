import { MonitorIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon, UploadIcon } from 'lucide-react';
import type { RefObject } from 'react';

import type { SearchMode } from '@al-yo-bo/shared';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Theme } from '@/lib/useTheme';

interface TopbarProps {
  query: string;
  mode: SearchMode;
  theme: Theme;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: SearchMode) => void;
  onThemeChange: (theme: Theme) => void;
  onAdd: () => void;
  onImport: () => void;
}

export function Topbar({
  query,
  mode,
  theme,
  searchRef,
  onQueryChange,
  onModeChange,
  onThemeChange,
  onAdd,
  onImport,
}: TopbarProps) {
  return (
    <header className="flex items-center gap-2 border-b border-border px-4 py-2">
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search bookmarks…  (press /)"
          className="pl-8"
          aria-label="Search bookmarks"
        />
      </div>

      <Select value={mode} onValueChange={(value) => onModeChange(value as SearchMode)}>
        <SelectTrigger className="w-32" aria-label="Search mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="keyword">Keyword</SelectItem>
          <SelectItem value="semantic">Semantic</SelectItem>
          <SelectItem value="hybrid">Hybrid</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="outline" onClick={onImport}>
        <UploadIcon data-icon="inline-start" />
        Import
      </Button>
      <Button onClick={onAdd}>
        <PlusIcon data-icon="inline-start" />
        Add
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Toggle theme">
            {theme === 'dark' ? <MoonIcon /> : theme === 'light' ? <SunIcon /> : <MonitorIcon />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onThemeChange('light')}>
            <SunIcon /> Light
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onThemeChange('dark')}>
            <MoonIcon /> Dark
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onThemeChange('system')}>
            <MonitorIcon /> System
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
