import { useCallback, useEffect, useState } from 'react';

interface UseListKeyboardNavOptions<T> {
  items: T[];
  getId: (item: T) => string;
  listRef: React.RefObject<HTMLElement | null>;
  /** Primary action invoked by Enter on the row focus target. */
  onActivate?: (item: T) => void;
  /** Delete action invoked by Delete/Backspace. */
  onDelete?: (item: T) => void;
  mode?: 'list' | 'grid';
  /** Column count for grid navigation; ignored in list mode. */
  getColumnCount?: () => number;
  /** Selector for the focusable element inside each row. */
  focusSelector?: string;
}

interface UseListKeyboardNavResult {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  handleFocusIn: (event: React.FocusEvent<HTMLElement>) => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * Roving focus list navigation: arrows/Home/End move focus between rows,
 * Enter activates, Delete/Backspace removes. Grid mode is column-aware when
 * `getColumnCount` is supplied. Handlers attach to interactive elements inside
 * each row; the list element itself stays handler-free.
 */
export function useListKeyboardNav<T>({
  items,
  getId,
  listRef,
  onActivate,
  onDelete,
  mode = 'list',
  getColumnCount,
  focusSelector = '[data-row-focus]',
}: UseListKeyboardNavOptions<T>): UseListKeyboardNavResult {
  const [activeId, setActiveId] = useState<string | null>(items[0] ? getId(items[0]) : null);

  // Keep the roving focus target valid when the item set changes.
  useEffect(() => {
    const first = items[0];
    if (!first) {
      setActiveId(null);
      return;
    }
    if (!items.some((item) => getId(item) === activeId)) {
      setActiveId(getId(first));
    }
  }, [items, activeId, getId]);

  const handleFocusIn = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const row = event.target.closest<HTMLElement>('[data-item-id]');
      if (!row) return;
      const id = row.dataset.itemId;
      if (id) {
        setActiveId((current) => (current === id ? current : id));
      }
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const row = event.currentTarget.closest<HTMLElement>('[data-item-id]');
      if (!row) return;
      const index = Number(row.dataset.index);
      const item = items[index];
      if (!Number.isFinite(index) || !item) return;

      const lastIndex = items.length - 1;
      let nextIndex = index;

      switch (event.key) {
        case 'Enter': {
          if (onActivate && event.currentTarget.matches(focusSelector)) {
            onActivate(item);
            event.preventDefault();
          }
          return;
        }
        case 'Delete':
        case 'Backspace': {
          if (onDelete) {
            onDelete(item);
            event.preventDefault();
          }
          return;
        }
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = lastIndex;
          break;
        case 'ArrowUp':
          nextIndex = mode === 'grid' && getColumnCount ? index - getColumnCount() : index - 1;
          break;
        case 'ArrowDown':
          nextIndex = mode === 'grid' && getColumnCount ? index + getColumnCount() : index + 1;
          break;
        case 'ArrowLeft':
          if (mode === 'grid') nextIndex = index - 1;
          break;
        case 'ArrowRight':
          if (mode === 'grid') nextIndex = index + 1;
          break;
        default:
          return;
      }

      nextIndex = Math.max(0, Math.min(lastIndex, nextIndex));
      const nextItem = items[nextIndex];
      if (nextIndex === index || !nextItem) return;

      const nextRow = listRef.current
        ?.querySelectorAll<HTMLElement>('[data-item-id]')
        .item(nextIndex);
      const nextFocus = nextRow?.querySelector<HTMLElement>(focusSelector);
      if (nextFocus) {
        nextFocus.focus();
        setActiveId(getId(nextItem));
        event.preventDefault();
      }
    },
    [items, getId, listRef, onActivate, onDelete, mode, getColumnCount, focusSelector],
  );

  return { activeId, setActiveId, handleFocusIn, handleKeyDown };
}
