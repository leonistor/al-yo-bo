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

interface TopbarAccountMenuProps {
  profile: Profile | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function TopbarAccountMenu({
  profile,
  theme,
  onThemeChange,
}: TopbarAccountMenuProps) {
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
            className="gap-2 px-1.5"
            aria-label="Account and theme"
          />
        }
      >
        {displayName && (
          <span className="hidden text-sm text-muted-foreground lg:inline">
            {displayName}
          </span>
        )}
        {profile ? (
          <ProfileAvatar profile={profile} className="size-8" />
        ) : (
          <UserIcon className="size-8 rounded-full bg-muted p-1.5 text-muted-foreground" />
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
