import type { LucideIcon } from 'lucide-react';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  options: SegmentedControlOption<T>[];
  disabled?: boolean;
}

interface SegmentedControlButtonProps<T extends string> {
  option: SegmentedControlOption<T>;
  active: boolean;
  disabled: boolean;
  onSelect: (value: T) => void;
}

function SegmentedControlButton<T extends string>({
  option,
  active,
  disabled,
  onSelect,
}: SegmentedControlButtonProps<T>) {
  const { value, label, icon: Icon } = option;
  const handleClick = useCallback(() => onSelect(value), [onSelect, value]);

  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 sm:text-sm',
        active
          ? 'bg-background text-foreground ring-1 ring-border'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5 sm:size-4" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Shared segmented control: a fieldset of icon+label toggle buttons with a
 * visible legend. Used for theme, layout, and default search mode preferences.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  label,
  options,
  disabled = false,
}: SegmentedControlProps<T>) {
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="inline-flex items-center rounded-lg border border-border bg-muted p-0.5">
        {options.map((option) => (
          <SegmentedControlButton
            key={option.value}
            option={option}
            active={value === option.value}
            disabled={disabled}
            onSelect={onValueChange}
          />
        ))}
      </div>
    </fieldset>
  );
}
