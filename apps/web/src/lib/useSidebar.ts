import { useCallback, useState } from 'react';

import { createSafeStorage } from '@/lib/storage';

/** Expanded-sidebar drag bounds and the collapsed rail width (DESIGN.md §Sidebar). */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_RAIL_WIDTH = 56;

const WIDTH_KEY = 'ayb:sidebar:width';
const COLLAPSED_KEY = 'ayb:sidebar:collapsed';
const SECTIONS_KEY = 'ayb:sidebar:sections';

/** localStorage with an in-memory fallback for sandboxed/private-mode contexts. */
const storage = createSafeStorage('ayb:sidebar:probe');

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/** Reads the persisted open/closed map, dropping anything that is not a boolean. */
function readOpenSections(): Record<string, boolean> {
  const raw = storage.get(SECTIONS_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const sections: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') {
        sections[key] = value;
      }
    }
    return sections;
  } catch {
    return {};
  }
}

export interface UseSidebar {
  width: number;
  collapsed: boolean;
  /** Open state per collapsible group key (`section:<id>`, `tags`). */
  openSections: Record<string, boolean>;
  setWidth: (width: number) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setOpenSection: (key: string, open: boolean) => void;
}

/**
 * Sidebar layout state (DESIGN.md §Sidebar): width, collapsed rail, and the
 * per-group open map are all persisted to localStorage. Width is clamped to
 * 200–360 so a stale or malformed stored value can never break the layout.
 */
export function useSidebar(): UseSidebar {
  const [width, setWidthState] = useState<number>(() => {
    const stored = Number(storage.get(WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsedState] = useState<boolean>(
    () => storage.get(COLLAPSED_KEY) === 'true',
  );
  const [openSections, setOpenSectionsState] =
    useState<Record<string, boolean>>(readOpenSections);

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    storage.set(WIDTH_KEY, String(clamped));
    setWidthState(clamped);
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    storage.set(COLLAPSED_KEY, String(next));
    setCollapsedState(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((current) => {
      const next = !current;
      storage.set(COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  const setOpenSection = useCallback((key: string, open: boolean) => {
    setOpenSectionsState((current) => {
      const next = { ...current, [key]: open };
      storage.set(SECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return {
    width,
    collapsed,
    openSections,
    setWidth,
    setCollapsed,
    toggleCollapsed,
    setOpenSection,
  };
}
