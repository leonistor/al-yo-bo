import { MonitorIcon, MoonIcon, SunIcon, UserIcon } from 'lucide-react';
import { useCallback } from 'react';

import type { Profile } from '@al-yo-bo/shared';

import { ProfileAvatar } from '@/components/ProfileAvatar';
import { cn } from '@/lib/utils';
import type { ButtonProps } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  size?: ButtonProps['size'];
}

/**
 * Profile + theme menu. The expanded sidebar header and the collapsed rail both
 * use the avatar trigger; the dropdown carries identity and theme radios. The
 * `system` option stays here while a separate `ThemeToggle` cycles light↔dark.
 */
export function SidebarAccountMenu({
  profile,
  theme,
  onThemeChange,
  size = 'icon',
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
            size={size}
            aria-label="Account and theme"
          />
        }
      >
        {profile ? (
          <ProfileAvatar profile={profile} className={size === 'icon-sm' ? 'size-6' : 'size-7'} />
        ) : (
          <UserIcon
            className={cn(
              'rounded-full bg-muted p-1 text-muted-foreground',
              size === 'icon-sm' ? 'size-6' : 'size-7',
            )}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {profile && (
          <>
            {/* GroupLabel (DropdownMenuLabel) requires a Menu.Group ancestor. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            </DropdownMenuGroup>
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
