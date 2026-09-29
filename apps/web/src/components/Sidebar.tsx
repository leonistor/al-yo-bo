import { FolderOpenIcon, HashIcon, InboxIcon, Settings2Icon } from 'lucide-react';

import type { Aggregates } from '@al-yo-bo/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface SidebarProps {
  aggregates: Aggregates | null;
  view: 'library' | 'review';
  selectedCategoryId: string | null;
  selectedTagId: string | null;
  reviewCount: number;
  onSelectView: (view: 'library' | 'review') => void;
  onSelectCategory: (id: string | null) => void;
  onSelectTag: (id: string | null) => void;
  onManageVocabulary: () => void;
}

const rowClass =
  'w-full justify-start gap-2 px-2 font-normal data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

export function Sidebar({
  aggregates,
  view,
  selectedCategoryId,
  selectedTagId,
  reviewCount,
  onSelectView,
  onSelectCategory,
  onSelectTag,
  onManageVocabulary,
}: SidebarProps) {
  const categories = aggregates?.categories.filter((category) => category.count > 0) ?? [];
  const tags = aggregates?.tags.filter((tag) => tag.count > 0).slice(0, 14) ?? [];

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">al-yo-bo</span>
        <Badge variant="secondary" className="ml-auto">
          {aggregates?.total ?? 0}
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-1 px-2 pb-4">
          <Button
            variant="ghost"
            className={rowClass}
            data-active={view === 'library' && !selectedCategoryId && !selectedTagId}
            onClick={() => {
              onSelectView('library');
              onSelectCategory(null);
              onSelectTag(null);
            }}
          >
            <InboxIcon />
            <span>All bookmarks</span>
          </Button>

          <Button
            variant="ghost"
            className={rowClass}
            data-active={view === 'review'}
            onClick={() => onSelectView('review')}
          >
            <Settings2Icon />
            <span>Review queue</span>
            {reviewCount > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {reviewCount}
              </Badge>
            )}
          </Button>

          <div className="mt-4 flex items-center justify-between px-2">
            <span className="text-xs font-medium text-muted-foreground">Categories</span>
            <Button variant="ghost" size="icon-sm" aria-label="New category" onClick={onManageVocabulary}>
              <FolderOpenIcon />
            </Button>
          </div>

          {categories.map((category) => (
            <Button
              key={category.id}
              variant="ghost"
              className={rowClass}
              data-active={view === 'library' && selectedCategoryId === category.id}
              onClick={() => {
                onSelectView('library');
                onSelectTag(null);
                onSelectCategory(selectedCategoryId === category.id ? null : category.id);
              }}
            >
              <FolderOpenIcon />
              <span className="truncate">{category.name}</span>
              <span className={cn('ml-auto text-xs text-muted-foreground')}>{category.count}</span>
            </Button>
          ))}

          <div className="mt-4 flex items-center justify-between px-2">
            <span className="text-xs font-medium text-muted-foreground">Tags</span>
            <Button variant="ghost" size="icon-sm" aria-label="New tag" onClick={onManageVocabulary}>
              <HashIcon />
            </Button>
          </div>

          {tags.map((tag) => (
            <Button
              key={tag.id}
              variant="ghost"
              className={rowClass}
              data-active={view === 'library' && selectedTagId === tag.id}
              onClick={() => {
                onSelectView('library');
                onSelectCategory(null);
                onSelectTag(selectedTagId === tag.id ? null : tag.id);
              }}
            >
              <HashIcon />
              <span className="truncate">{tag.name}</span>
              <span className={cn('ml-auto text-xs text-muted-foreground')}>{tag.count}</span>
            </Button>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}
