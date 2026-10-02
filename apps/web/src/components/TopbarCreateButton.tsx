import { ChevronDownIcon, PlusIcon, UploadIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TopbarCreateButtonProps {
  onAdd: () => void;
  onImport: () => void;
}

export function TopbarCreateButton({ onAdd, onImport }: TopbarCreateButtonProps) {
  return (
    <div className="flex items-center">
      <Button onClick={onAdd} className="rounded-r-none pr-2 sm:pr-3">
        <PlusIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Add</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="rounded-l-none border-l border-primary-foreground/20 px-1.5 sm:px-2"
              aria-label="More create options"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onImport}>
            <UploadIcon /> Import
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
