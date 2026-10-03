import { MoonIcon, SunIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { ButtonProps } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { resolved, type Theme } from '@/lib/useTheme';

interface ThemeToggleProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  size?: ButtonProps['size'];
}

/**
 * Standalone light/dark toggle. `system` is resolved to its actual value for the
 * icon state; clicking always commits to the opposite explicit theme. The
 * account dropdown still exposes the `system` option.
 */
export function ThemeToggle({ theme, onThemeChange, size = 'icon' }: ThemeToggleProps) {
  const [resolvedTheme, setResolvedTheme] = useState(() => resolved(theme));

  useEffect(() => {
    setResolvedTheme(resolved(theme));
    if (theme !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setResolvedTheme(resolved('system'));
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  const next = resolvedTheme === 'light' ? 'dark' : 'light';
  const Icon = resolvedTheme === 'light' ? SunIcon : MoonIcon;
  const label = `Switch to ${next} theme`;

  const handleClick = useCallback(() => onThemeChange(next), [onThemeChange, next]);

  return (
    <Button
      variant="ghost"
      size={size}
      aria-label={label}
      title={label}
      onClick={handleClick}
    >
      <Icon />
    </Button>
  );
}
