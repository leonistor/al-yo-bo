import { UserIcon } from 'lucide-react';
import { useCallback } from 'react';

import type { Profile } from '@al-yo-bo/shared';

import { ProfileAvatar } from '@/components/ProfileAvatar';
import type { ButtonProps } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';

interface SidebarAccountMenuProps {
  profile: Profile | null;
  onNavigateProfile?: () => void;
  size?: ButtonProps['size'];
}

/**
 * Sidebar profile entry. The header (expanded and collapsed rail) and the
 * mobile sheet all use this plain link button to `#/profile`; theme lives in
 * the separate cycling `ThemeToggle`, so no dropdown remains in the sidebar.
 */
export function SidebarAccountMenu({
  profile,
  onNavigateProfile,
  size = 'icon-sm',
}: SidebarAccountMenuProps) {
  const handleProfileClick = useCallback(() => {
    if (onNavigateProfile) {
      onNavigateProfile();
    } else {
      navigate('profile');
    }
  }, [onNavigateProfile]);

  return (
    <Button
      variant="ghost"
      size={size}
      aria-label="Profile & settings"
      onClick={handleProfileClick}
    >
      {profile ? (
        <ProfileAvatar profile={profile} className={size === 'icon-sm' ? 'size-7' : 'size-8'} />
      ) : (
        <UserIcon
          className={cn(
            'rounded-full bg-muted p-1 text-muted-foreground',
            size === 'icon-sm' ? 'size-7' : 'size-8',
          )}
        />
      )}
    </Button>
  );
}
