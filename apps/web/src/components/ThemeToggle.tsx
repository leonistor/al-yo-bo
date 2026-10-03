import type { LucideIcon } from 'lucide-react';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type { ButtonProps } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Theme } from '@/lib/useTheme';

interface ThemeToggleProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  size?: ButtonProps['size'];
}

// Cycle order: light → dark → system → light. `system` sits last so the two
// explicit modes stay one click apart and the label reads predictably.
const NEXT_THEME: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const THEME_ICON: Record<Theme, LucideIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

/**
 * Three-way theme cycle button (light → dark → system). The icon and tooltip
 * reflect the stored mode — not its resolved value — so `system` stays visible
 * as a distinct state. Theme state is owned by the app's `useTheme` instance
 * and passed in, keeping every toggle in sync.
 */
export function ThemeToggle({ theme, onThemeChange, size = 'icon' }: ThemeToggleProps) {
  const Icon = THEME_ICON[theme];
  const label = `Theme: ${theme}`;

  const handleClick = useCallback(() => {
    onThemeChange(NEXT_THEME[theme]);
  }, [theme, onThemeChange]);

  const triggerRender = useMemo(
    () => <Button variant="ghost" size={size} aria-label={label} onClick={handleClick} />,
    [size, label, handleClick],
  );

  return (
    <Tooltip>
      <TooltipTrigger render={triggerRender}>
        <Icon />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
