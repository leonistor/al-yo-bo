import { MonitorIcon, MoonIcon, SunIcon, UserIcon } from 'lucide-react';
import { useCallback } from 'react';

import type { Profile } from '@al-yo-bo/shared';

import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Theme } from '@/lib/useTheme';

interface SidebarAccountMenuProps {
  profile: Profile | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

/**
 * Profile + theme menu (DESIGN.md §Sidebar info architecture: the sidebar footer
 * — not the topbar — owns Profile & theme). The compact avatar trigger keeps the
 * rail-width footer usable; the dropdown carries the identity and theme radios.
 */
export function SidebarAccountMenu({
  profile,
  theme,
  onThemeChange,
}: SidebarAccountMenuProps) {
  const handleThemeChange = useCallback(
    (value: string) => {
      if (value === 'light' || value === 'dark' || value === 'system') {
        onThemeChange(value);
      }
    },
    [onThemeChange],
  );

  const displayName = profile?.name ?? profile?.githubUsername;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="justify-start"
            aria-label="Account and theme"
          />
        }
      >
        {profile ? (
          <ProfileAvatar profile={profile} className="size-6" />
        ) : (
          <UserIcon className="size-6 rounded-full bg-muted p-1 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {profile && (
          <>
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
          <DropdownMenuRadioItem value="light">
            <SunIcon /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
