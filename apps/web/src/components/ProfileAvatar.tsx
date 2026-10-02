import { UserIcon } from 'lucide-react';

import type { Profile } from '@al-yo-bo/shared';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/** Derives up to two initials from the profile name ("Leo Nistor" → "LN"). */
function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/**
 * The single user's avatar (DESIGN.md: calm, dense, no decoration). An
 * uploaded file wins; the fallback renders initials derived from the profile
 * name, or a person glyph when no name is set. The serve route is immutable,
 * so `?v=<updatedAt>` cache-busts on re-upload (the stored file name is fixed).
 * Decorative: every surface that shows it also shows the name as text.
 */
export function ProfileAvatar({
  profile,
  className,
}: {
  profile: Profile | null;
  className?: string;
}) {
  const src = profile?.avatarPath ? `/data/profile/avatar?v=${profile.updatedAt}` : undefined;
  const label = initials(profile?.name ?? null);
  return (
    <Avatar className={className} aria-hidden="true">
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback>{label ? label : <UserIcon />}</AvatarFallback>
    </Avatar>
  );
}
