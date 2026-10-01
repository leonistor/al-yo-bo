import {
  FolderOpenIcon,
  HashIcon,
  InboxIcon,
  PanelLeftIcon,
  Settings2Icon,
  TagsIcon,
} from 'lucide-react';

import type { Aggregates } from '@al-yo-bo/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SidebarProps {
  aggregates: Aggregates | null;
  view: 'library' | 'review';
  selectedCategoryId: string | null;
  selectedTagId: string | null;
  reviewCount: number;
  /** 'full' = labelled rail (≥lg); 'rail' = icon rail (md–lg, per DESIGN.md). */
  variant?: 'full' | 'rail';
  /** Rail only: opens the full navigation sheet on small screens. */
  onOpenNav?: () => void;
  onSelectView: (view: 'library' | 'review') => void;
  onSelectCategory: (id: string | null) => void;
  onSelectTag: (id: string | null) => void;
  onManageVocabulary: () => void;
}

interface SidebarNavProps extends Omit<SidebarProps, 'variant' | 'onOpenNav'> {
  /** Called after any selection; mobile sheet uses it to close itself. */
  onNavigate?: () => void;
}

const rowClass =
  'w-full justify-start gap-2 px-2 font-normal data-[active=true]:bg-accent data-[active=true]:text-accent-foreground';

/** Shared nav body: identical content in the desktop rail and the mobile sheet. */
function SidebarNav({
  aggregates,
  view,
  selectedCategoryId,
  selectedTagId,
  reviewCount,
  onSelectView,
  onSelectCategory,
  onSelectTag,
  onManageVocabulary,
  onNavigate,
}: SidebarNavProps) {
  const categories = aggregates?.categories.filter((category) => category.count > 0) ?? [];
  const tags = aggregates?.tags.filter((tag) => tag.count > 0).slice(0, 14) ?? [];

  return (
    <nav className="flex flex-col gap-1 px-2 pb-4">
      <Button
        variant="ghost"
        className={rowClass}
        data-active={view === 'library' && !selectedCategoryId && !selectedTagId}
        onClick={() => {
          onSelectView('library');
          onSelectCategory(null);
          onSelectTag(null);
          onNavigate?.();
        }}
      >
        <InboxIcon />
        <span>All bookmarks</span>
        <Badge variant="secondary" className="ml-auto">
          {aggregates?.total ?? 0}
        </Badge>
      </Button>

      <Button
        variant="ghost"
        className={rowClass}
        data-active={view === 'review'}
        onClick={() => {
          onSelectView('review');
          onNavigate?.();
        }}
      >
        <Settings2Icon />
        <span>Review queue</span>
        {reviewCount > 0 && (
          <Badge variant="secondary" className="ml-auto">
            {reviewCount}
          </Badge>
        )}
      </Button>

      <div className="mt-4 px-2">
        <span className="text-xs font-medium text-muted-foreground">Categories</span>
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
            onNavigate?.();
          }}
        >
          <FolderOpenIcon />
          <span className="truncate">{category.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">{category.count}</span>
        </Button>
      ))}

      <div className="mt-4 px-2">
        <span className="text-xs font-medium text-muted-foreground">Tags</span>
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
            onNavigate?.();
          }}
        >
          <HashIcon />
          <span className="truncate">{tag.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">{tag.count}</span>
        </Button>
      ))}

      <Button
        variant="ghost"
        className={cn(rowClass, 'mt-4')}
        onClick={() => {
          onManageVocabulary();
          onNavigate?.();
        }}
      >
        <TagsIcon />
        <span>Manage vocabulary</span>
      </Button>
    </nav>
  );
}

function RailButton({
  label,
  onClick,
  children,
  badge,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          data-active={active}
          className="relative data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
          onClick={onClick}
        >
          {children}
          {badge !== undefined && badge > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-medium text-primary-foreground">
              {badge}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({
  aggregates,
  view,
  selectedCategoryId,
  selectedTagId,
  reviewCount,
  variant = 'full',
  onOpenNav,
  onSelectView,
  onSelectCategory,
  onSelectTag,
  onManageVocabulary,
}: SidebarProps) {
  if (variant === 'rail') {
    const categories = aggregates?.categories.filter((category) => category.count > 0) ?? [];
    const firstCategory = categories[0];
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground">
        <RailButton
          label="All bookmarks"
          active={view === 'library' && !selectedCategoryId && !selectedTagId}
          onClick={() => {
            onSelectView('library');
            onSelectCategory(null);
            onSelectTag(null);
          }}
        >
          <InboxIcon />
        </RailButton>
        <RailButton
          label={`Review queue${reviewCount > 0 ? ` (${reviewCount})` : ''}`}
          badge={reviewCount}
          active={view === 'review'}
          onClick={() => onSelectView('review')}
        >
          <Settings2Icon />
        </RailButton>
        {firstCategory && (
          <RailButton
            label={`Categories (${categories.length})`}
            active={view === 'library' && selectedCategoryId !== null}
            onClick={() => {
              onSelectView('library');
              onSelectTag(null);
              onSelectCategory(selectedCategoryId ?? firstCategory.id);
            }}
          >
            <FolderOpenIcon />
          </RailButton>
        )}
        <div className="mt-auto flex flex-col items-center gap-1">
          <RailButton label="Manage vocabulary" onClick={onManageVocabulary}>
            <TagsIcon />
          </RailButton>
          <RailButton label="Full navigation" onClick={() => onOpenNav?.()}>
            <PanelLeftIcon />
          </RailButton>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">al-yo-bo</span>
        <Badge variant="secondary" className="ml-auto">
          {aggregates?.total ?? 0}
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <SidebarNav
          aggregates={aggregates}
          view={view}
          selectedCategoryId={selectedCategoryId}
          selectedTagId={selectedTagId}
          reviewCount={reviewCount}
          onSelectView={onSelectView}
          onSelectCategory={onSelectCategory}
          onSelectTag={onSelectTag}
          onManageVocabulary={onManageVocabulary}
        />
      </ScrollArea>
    </aside>
  );
}

export { SidebarNav };
