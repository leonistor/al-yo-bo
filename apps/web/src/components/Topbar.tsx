import { MenuIcon, MessageSquareIcon, PlusIcon } from 'lucide-react';
import type { RefObject } from 'react';

import type { SearchMode } from '@al-yo-bo/shared';

import { Button } from '@/components/ui/button';

import { TopbarSearch } from './TopbarSearch';

interface TopbarProps {
  query: string;
  mode: SearchMode;
  searchRef: RefObject<HTMLInputElement | null>;
  chatOpen: boolean;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: SearchMode) => void;
  onAdd: () => void;
  onToggleChat: () => void;
  /** Below md the sidebar is hidden; this opens it as an off-canvas sheet. */
  onOpenNav: () => void;
}

/**
 * Command bar — content header row 1 (DESIGN.md §Command bar). Owns search and
 * the chat/Add actions only; navigation and the account menu live in the sidebar.
 */
export function Topbar({
  query,
  mode,
  searchRef,
  chatOpen,
  onQueryChange,
  onModeChange,
  onAdd,
  onToggleChat,
  onOpenNav,
}: TopbarProps) {
  return (
    <header className="flex items-center gap-1.5 border-b border-border px-3 py-2 sm:gap-2 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        className="md:hidden"
        onClick={onOpenNav}
      >
        <MenuIcon />
      </Button>

      <TopbarSearch
        query={query}
        mode={mode}
        searchRef={searchRef}
        onQueryChange={onQueryChange}
        onModeChange={onModeChange}
      />

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

      <Button onClick={onAdd} aria-label="Add bookmark">
        <PlusIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Add</span>
      </Button>
    </header>
  );
}
