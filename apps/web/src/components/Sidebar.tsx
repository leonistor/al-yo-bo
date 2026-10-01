import type { Aggregates, CategoryAggregate, TagAggregate } from '@al-yo-bo/shared';
import {
  FolderOpenIcon,
  HashIcon,
  InboxIcon,
  LayersIcon,
  PanelLeftIcon,
  Settings2Icon,
  TagsIcon,
} from 'lucide-react';
import { useCallback } from 'react';

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

interface NavSelectionProps {
  onSelectView: (view: 'library' | 'review') => void;
  onSelectCategory: (id: string | null) => void;
  onSelectTag: (id: string | null) => void;
  onNavigate?: () => void;
}

interface CategoryRowProps extends NavSelectionProps {
  category: CategoryAggregate;
  /** Row highlights only while the library view is showing categories. */
  active: boolean;
  selectedCategoryId: string | null;
}

/** One category entry; owns its per-row select handler so the list body stays clean. */
function CategoryRow({
  category,
  active,
  selectedCategoryId,
  onSelectView,
  onSelectCategory,
  onSelectTag,
  onNavigate,
}: CategoryRowProps) {
  const handleSelect = useCallback(() => {
    onSelectView('library');
    onSelectTag(null);
    onSelectCategory(selectedCategoryId === category.id ? null : category.id);
    onNavigate?.();
  }, [onSelectView, onSelectTag, onSelectCategory, selectedCategoryId, category.id, onNavigate]);

  return (
    <Button
      variant="ghost"
      className={cn(rowClass, 'pl-6')}
      data-active={active}
      onClick={handleSelect}
    >
      <FolderOpenIcon />
      <span className="truncate">{category.name}</span>
      <span className="ml-auto text-xs text-muted-foreground">{category.count}</span>
    </Button>
  );
}

interface TagRowProps extends NavSelectionProps {
  tag: TagAggregate;
  active: boolean;
  selectedTagId: string | null;
}

/** One tag entry; same per-row handler pattern as CategoryRow. */
function TagRow({
  tag,
  active,
  selectedTagId,
  onSelectView,
  onSelectCategory,
  onSelectTag,
  onNavigate,
}: TagRowProps) {
  const handleSelect = useCallback(() => {
    onSelectView('library');
    onSelectCategory(null);
    onSelectTag(selectedTagId === tag.id ? null : tag.id);
    onNavigate?.();
  }, [onSelectView, onSelectCategory, onSelectTag, selectedTagId, tag.id, onNavigate]);

  return (
    <Button variant="ghost" className={rowClass} data-active={active} onClick={handleSelect}>
      <HashIcon />
      <span className="truncate">{tag.name}</span>
      <span className="ml-auto text-xs text-muted-foreground">{tag.count}</span>
    </Button>
  );
}

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
  const sections = aggregates?.sections.filter((section) => section.count > 0) ?? [];
  const uncategorized = categories.filter((category) => category.sectionId === null);

  const showAll = useCallback(() => {
    onSelectView('library');
    onSelectCategory(null);
    onSelectTag(null);
    onNavigate?.();
  }, [onSelectView, onSelectCategory, onSelectTag, onNavigate]);

  const showReview = useCallback(() => {
    onSelectView('review');
    onNavigate?.();
  }, [onSelectView, onNavigate]);

  const openVocabulary = useCallback(() => {
    onManageVocabulary();
    onNavigate?.();
  }, [onManageVocabulary, onNavigate]);

  return (
    <nav className="flex flex-col gap-1 px-2 pb-4">
      <Button
        variant="ghost"
        className={rowClass}
        data-active={view === 'library' && !selectedCategoryId && !selectedTagId}
        onClick={showAll}
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
        onClick={showReview}
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
        <span className="text-xs font-medium text-muted-foreground">Sections</span>
      </div>
      {sections.map((section) => {
        const sectionCategories = categories.filter((c) => c.sectionId === section.id);
        return (
          <div key={section.id} className="flex flex-col">
            <div className="flex items-center gap-2 px-2 py-1">
              <LayersIcon className="size-3.5 text-muted-foreground" />
              <span className="truncate text-xs font-medium">{section.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{section.count}</span>
            </div>
            {sectionCategories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                active={view === 'library' && selectedCategoryId === category.id}
                selectedCategoryId={selectedCategoryId}
                onSelectView={onSelectView}
                onSelectCategory={onSelectCategory}
                onSelectTag={onSelectTag}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        );
      })}

      {uncategorized.length > 0 && (
        <div className="flex flex-col">
          <div className="flex items-center gap-2 px-2 py-1">
            <LayersIcon className="size-3.5 text-muted-foreground" />
            <span className="truncate text-xs font-medium">Other</span>
          </div>
          {uncategorized.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              active={view === 'library' && selectedCategoryId === category.id}
              selectedCategoryId={selectedCategoryId}
              onSelectView={onSelectView}
              onSelectCategory={onSelectCategory}
              onSelectTag={onSelectTag}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}

      <div className="mt-4 px-2">
        <span className="text-xs font-medium text-muted-foreground">Tags</span>
      </div>
      {tags.map((tag) => (
        <TagRow
          key={tag.id}
          tag={tag}
          active={view === 'library' && selectedTagId === tag.id}
          selectedTagId={selectedTagId}
          onSelectView={onSelectView}
          onSelectCategory={onSelectCategory}
          onSelectTag={onSelectTag}
          onNavigate={onNavigate}
        />
      ))}

      <Button variant="ghost" className={cn(rowClass, 'mt-4')} onClick={openVocabulary}>
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
  const categories = aggregates?.categories.filter((category) => category.count > 0) ?? [];
  const firstCategoryId = categories[0]?.id;

  const showAll = useCallback(() => {
    onSelectView('library');
    onSelectCategory(null);
    onSelectTag(null);
  }, [onSelectView, onSelectCategory, onSelectTag]);

  const showReview = useCallback(() => onSelectView('review'), [onSelectView]);

  const showFirstCategory = useCallback(() => {
    onSelectView('library');
    onSelectTag(null);
    // The button only renders when a category exists, so the fallback never fires.
    onSelectCategory(selectedCategoryId ?? firstCategoryId ?? null);
  }, [onSelectView, onSelectTag, onSelectCategory, selectedCategoryId, firstCategoryId]);

  const openNav = useCallback(() => onOpenNav?.(), [onOpenNav]);

  if (variant === 'rail') {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground">
        <RailButton
          label="All bookmarks"
          active={view === 'library' && !selectedCategoryId && !selectedTagId}
          onClick={showAll}
        >
          <InboxIcon />
        </RailButton>
        <RailButton
          label={`Review queue${reviewCount > 0 ? ` (${reviewCount})` : ''}`}
          badge={reviewCount}
          active={view === 'review'}
          onClick={showReview}
        >
          <Settings2Icon />
        </RailButton>
        {firstCategoryId && (
          <RailButton
            label={`Categories (${categories.length})`}
            active={view === 'library' && selectedCategoryId !== null}
            onClick={showFirstCategory}
          >
            <FolderOpenIcon />
          </RailButton>
        )}
        <div className="mt-auto flex flex-col items-center gap-1">
          <RailButton label="Manage vocabulary" onClick={onManageVocabulary}>
            <TagsIcon />
          </RailButton>
          <RailButton label="Full navigation" onClick={openNav}>
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
