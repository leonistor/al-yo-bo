import { useCallback, useEffect, useRef, useState } from 'react';

interface UseInlineEditResult<T> {
  editing: boolean;
  draft: T;
  setDraft: React.Dispatch<React.SetStateAction<T>>;
  pending: boolean;
  startEdit: () => void;
  cancelEdit: () => void;
  commitEdit: () => Promise<void>;
  handleKeyDown: (event: React.KeyboardEvent) => void;
}

/**
 * Display-to-edit state machine for a single inline-editable row.
 * Enter commits, Escape cancels, and a pending flag drives the row spinner.
 */
export function useInlineEdit<T>(
  value: T,
  onCommit: (value: T) => Promise<void> | void,
): UseInlineEditResult<T> {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);
  const [pending, setPending] = useState(false);

  // Sync draft back to the live value whenever the user exits edit mode.
  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const startEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(value);
  }, [value]);

  // Keep the latest draft in a ref so `commitEdit` stays stable and reads the
  // current value when Enter is pressed, without recreating on every keystroke.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // draftRef is a ref, not a render value; onCommit is the only render dep.
  // eslint-disable-next-line react/memo-dependencies
  const commitEdit = useCallback(async () => {
    setPending(true);
    try {
      await onCommit(draftRef.current);
      setEditing(false);
    } finally {
      setPending(false);
    }
  }, [onCommit]);

  // commitEdit and cancelEdit are stable callbacks; listing them satisfies
  // the exhaustive-deps rule without recreating this handler on keystrokes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void commitEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
    },
    [commitEdit, cancelEdit],
  );

  return {
    editing,
    draft,
    setDraft,
    pending,
    startEdit,
    cancelEdit,
    commitEdit,
    handleKeyDown,
  };
}
