import {
  MenuIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  UploadIcon,
} from 'lucide-react';
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
  chatOpen: boolean;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: SearchMode) => void;
  onThemeChange: (theme: Theme) => void;
  onAdd: () => void;
  onImport: () => void;
  onToggleChat: () => void;
  /** Below md the sidebar is hidden; this opens it as an off-canvas sheet. */
  onOpenNav: () => void;
}

export function Topbar({
  query,
  mode,
  theme,
  searchRef,
  chatOpen,
  onQueryChange,
  onModeChange,
  onThemeChange,
  onAdd,
  onImport,
  onToggleChat,
  onOpenNav,
}: TopbarProps) {
  return (
    <header className="flex items-center gap-2 border-b border-border px-4 py-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        className="md:hidden"
        onClick={onOpenNav}
      >
        <MenuIcon />
      </Button>

      <div className="relative min-w-0 flex-1">
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
        <SelectTrigger className="w-28 sm:w-32" aria-label="Search mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="keyword">Keyword</SelectItem>
          <SelectItem value="semantic">Semantic</SelectItem>
          <SelectItem value="hybrid">Hybrid</SelectItem>
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        aria-label="Import bookmarks"
        className="sm:hidden"
        onClick={onImport}
      >
        <UploadIcon />
      </Button>
      <Button variant="outline" className="hidden sm:inline-flex" onClick={onImport}>
        <UploadIcon data-icon="inline-start" />
        Import
      </Button>

      <Button
        size="icon"
        aria-label="Add bookmark"
        className="sm:hidden"
        onClick={onAdd}
      >
        <PlusIcon />
      </Button>
      <Button className="hidden sm:inline-flex" onClick={onAdd}>
        <PlusIcon data-icon="inline-start" />
        Add
      </Button>

      <Button
        variant={chatOpen ? 'secondary' : 'outline'}
        size="icon"
        onClick={onToggleChat}
        aria-label="Toggle chat (press c)"
        aria-pressed={chatOpen}
        title="Chat (c)"
        className="sm:hidden"
      >
        <MessageSquareIcon />
      </Button>
      <Button
        variant={chatOpen ? 'secondary' : 'outline'}
        onClick={onToggleChat}
        aria-label="Toggle chat (press c)"
        aria-pressed={chatOpen}
        title="Chat (c)"
        className="hidden sm:inline-flex"
      >
        <MessageSquareIcon data-icon="inline-start" />
        Chat
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
