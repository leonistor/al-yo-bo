import { MenuIcon, MessageSquareIcon } from 'lucide-react';
import type { RefObject } from 'react';

import type { Profile, SearchMode } from '@al-yo-bo/shared';

import { Button } from '@/components/ui/button';
import type { Theme } from '@/lib/useTheme';

import { TopbarAccountMenu } from './TopbarAccountMenu';
import { TopbarCreateButton } from './TopbarCreateButton';
import { TopbarSearch } from './TopbarSearch';

interface TopbarProps {
  query: string;
  mode: SearchMode;
  theme: Theme;
  /** The single user's profile; null while loading or on a fetch error. */
  profile: Profile | null;
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
  profile,
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

      <TopbarCreateButton onAdd={onAdd} onImport={onImport} />
      <TopbarAccountMenu
        profile={profile}
        theme={theme}
        onThemeChange={onThemeChange}
      />
    </header>
  );
}
