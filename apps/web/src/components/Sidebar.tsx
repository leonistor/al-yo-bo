import type { Aggregates, CategoryAggregate, Profile, TagAggregate } from '@al-yo-bo/shared';
import {
  FolderOpenIcon,
  HashIcon,
  InboxIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Settings2Icon,
  TagsIcon,
  UploadIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { CollapsibleSection } from '@/components/CollapsibleSection';
import { SidebarAccountMenu } from '@/components/SidebarAccountMenu';
import { TagPill } from '@/components/TagPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from '@/lib/useSidebar';
import type { Theme } from '@/lib/useTheme';
import { cn } from '@/lib/utils';

/** Keys used in the persisted `ayb:sidebar:sections` open/closed map. */
const sectionKey = (id: string) => `section:${id}`;
const TAGS_KEY = 'tags';

interface SidebarNavProps {
  aggregates: Aggregates | null;
  profile: Profile | null;
  theme: Theme;
  view: 'library' | 'review';
  selectedCategoryId: string | null;
  selectedTagId: string | null;
  reviewCount: number;
  openSections: Record<string, boolean>;
  onSetOpenSection: (key: string, open: boolean) => void;
  onSelectView: (view: 'library' | 'review') => void;
  onSelectCategory: (id: string | null) => void;
  onSelectTag: (id: string | null) => void;
  onThemeChange: (theme: Theme) => void;
  onNavigateImport: () => void;
  onNavigateVocabulary: () => void;
  /** Called after any selection; mobile sheet uses it to close itself. */
  onNavigate?: () => void;
  /** Render the Tools block inline (the mobile sheet); the full sidebar pins it. */
  showTools?: boolean;
}

interface SidebarProps extends Omit<SidebarNavProps, 'onNavigate' | 'showTools'> {
  collapsed: boolean;
  width: number;
  onToggleCollapse: () => void;
  onSetWidth: (width: number) => void;
  onSetCollapsed: (collapsed: boolean) => void;
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
      className={cn(rowClass, 'pl-4')}
      data-active={active}
      onClick={handleSelect}
    >
      <FolderOpenIcon />
      <span className="truncate">{category.name}</span>
      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{category.count}</span>
    </Button>
  );
}

interface TagItemProps {
  tag: TagAggregate;
  selected: boolean;
  onToggle: (tagId: string) => void;
}

/** One sidebar tag pill; same per-item handler pattern as CategoryRow. */
function TagItem({ tag, selected, onToggle }: TagItemProps) {
  const handleClick = useCallback(() => onToggle(tag.id), [onToggle, tag.id]);

  return (
    <TagPill
      variant={selected ? 'selected' : 'outline'}
      count={tag.count}
      onClick={handleClick}
    >
      {tag.name}
    </TagPill>
  );
}

interface CollapsibleGroupProps {
  groupKey: string;
  title: string;
  count?: number;
  open: boolean;
  onSetOpenSection: (key: string, open: boolean) => void;
  children: ReactNode;
}

/** Thin adapter that keeps the CollapsibleSection open handler stable per group. */
function CollapsibleGroup({
  groupKey,
  title,
  count,
  open,
  onSetOpenSection,
  children,
}: CollapsibleGroupProps) {
  const handleOpenChange = useCallback(
    (next: boolean) => onSetOpenSection(groupKey, next),
    [onSetOpenSection, groupKey],
  );

  return (
    <CollapsibleSection title={title} count={count} open={open} onOpenChange={handleOpenChange}>
      {children}
    </CollapsibleSection>
  );
}

interface SidebarToolsProps {
  profile: Profile | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onNavigateImport: () => void;
  onNavigateVocabulary: () => void;
  onNavigate?: () => void;
}

/** Tools block (DESIGN.md §Sidebar info architecture): Import, Vocabulary, account. */
function SidebarTools({
  profile,
  theme,
  onThemeChange,
  onNavigateImport,
  onNavigateVocabulary,
  onNavigate,
}: SidebarToolsProps) {
  const handleImport = useCallback(() => {
    onNavigateImport();
    onNavigate?.();
  }, [onNavigateImport, onNavigate]);

  const handleVocabulary = useCallback(() => {
    onNavigateVocabulary();
    onNavigate?.();
  }, [onNavigateVocabulary, onNavigate]);

  return (
    <div className="flex flex-col gap-0.5">
      <Button variant="ghost" className={rowClass} onClick={handleImport}>
        <UploadIcon />
        <span>Import</span>
      </Button>
      <Button variant="ghost" className={rowClass} onClick={handleVocabulary}>
        <TagsIcon />
        <span>Vocabulary</span>
      </Button>
      <SidebarAccountMenu profile={profile} theme={theme} onThemeChange={onThemeChange} />
    </div>
  );
}

/** Shared nav body: identical content in the persistent sidebar and the mobile sheet. */
function SidebarNav({
  aggregates,
  profile,
  theme,
  view,
  selectedCategoryId,
  selectedTagId,
  reviewCount,
  openSections,
  onSetOpenSection,
  onSelectView,
  onSelectCategory,
  onSelectTag,
  onThemeChange,
  onNavigateImport,
  onNavigateVocabulary,
  onNavigate,
  showTools = true,
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

  const toggleTag = useCallback(
    (id: string) => {
      onSelectView('library');
      onSelectCategory(null);
      onSelectTag(selectedTagId === id ? null : id);
      onNavigate?.();
    },
    [onSelectView, onSelectCategory, onSelectTag, selectedTagId, onNavigate],
  );

  const categoryNavProps: NavSelectionProps = {
    onSelectView,
    onSelectCategory,
    onSelectTag,
    onNavigate,
  };

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
        <Badge variant="secondary" className="ml-auto tabular-nums">
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
          <Badge variant="secondary" className="ml-auto tabular-nums">
            {reviewCount}
          </Badge>
        )}
      </Button>

      {sections.map((section) => {
        const sectionCategories = categories.filter((c) => c.sectionId === section.id);
        return (
          <CollapsibleGroup
            key={section.id}
            groupKey={sectionKey(section.id)}
            title={section.name}
            count={section.count}
            open={openSections[sectionKey(section.id)] ?? true}
            onSetOpenSection={onSetOpenSection}
          >
            <div className="ml-3 flex flex-col border-l-2 border-border/60">
              {sectionCategories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  active={view === 'library' && selectedCategoryId === category.id}
                  selectedCategoryId={selectedCategoryId}
                  {...categoryNavProps}
                />
              ))}
            </div>
          </CollapsibleGroup>
        );
      })}

      {uncategorized.length > 0 && (
        <CollapsibleGroup
          groupKey={sectionKey('uncategorized')}
          title="Other"
          open={openSections[sectionKey('uncategorized')] ?? true}
          onSetOpenSection={onSetOpenSection}
        >
          <div className="ml-3 flex flex-col border-l-2 border-border/60">
            {uncategorized.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                active={view === 'library' && selectedCategoryId === category.id}
                selectedCategoryId={selectedCategoryId}
                {...categoryNavProps}
              />
            ))}
          </div>
        </CollapsibleGroup>
      )}

      <CollapsibleGroup
        groupKey={TAGS_KEY}
        title="Tags"
        count={tags.length}
        open={openSections[TAGS_KEY] ?? true}
        onSetOpenSection={onSetOpenSection}
      >
        <div className="flex flex-wrap gap-1.5 p-2">
          {tags.map((tag) => (
            <TagItem
              key={tag.id}
              tag={tag}
              selected={selectedTagId === tag.id}
              onToggle={toggleTag}
            />
          ))}
        </div>
      </CollapsibleGroup>

      {showTools && (
        <div className="mt-4 border-t border-sidebar-border pt-2">
          <SidebarTools
            profile={profile}
            theme={theme}
            onThemeChange={onThemeChange}
            onNavigateImport={onNavigateImport}
            onNavigateVocabulary={onNavigateVocabulary}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </nav>
  );
}

interface RailButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  badge?: number;
  active?: boolean;
}

/** Icon-rail entry with a tooltip; review keeps a count badge. */
function RailButton({ label, onClick, children, badge, active }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={active}
            data-active={active}
            className="relative data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
            onClick={onClick}
          />
        }
      >
        {children}
        {badge !== undefined && badge > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-medium text-primary-foreground tabular-nums">
            {badge}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({
  aggregates,
  profile,
  theme,
  view,
  selectedCategoryId,
  selectedTagId,
  reviewCount,
  openSections,
  onSetOpenSection,
  onSelectView,
  onSelectCategory,
  onSelectTag,
  onThemeChange,
  onNavigateImport,
  onNavigateVocabulary,
  collapsed,
  width,
  onToggleCollapse,
  onSetWidth,
  onSetCollapsed,
}: SidebarProps) {
  const categories = aggregates?.categories.filter((category) => category.count > 0) ?? [];
  const tags = aggregates?.tags.filter((tag) => tag.count > 0).slice(0, 14) ?? [];

  // Drag preview state: while dragging we render a local width so the persisted
  // value is only written once, on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const dragWidthRef = useRef<number | null>(null);

  const setPreviewWidth = useCallback((next: number | null) => {
    dragWidthRef.current = next;
    setDragWidth(next);
  }, []);

  // A dragged width below the minimum collapses the sidebar; dragging right from
  // the rail expands it again at the dragged width (DESIGN.md §Sidebar snap rule).
  const effectiveWidth = dragWidth ?? (collapsed ? SIDEBAR_RAIL_WIDTH : width);
  const effectiveCollapsed = dragWidth === null ? collapsed : dragWidth < SIDEBAR_MIN_WIDTH;
  const renderWidth = effectiveCollapsed ? SIDEBAR_RAIL_WIDTH : effectiveWidth;
  const asideStyle = useMemo(() => ({ width: renderWidth }), [renderWidth]);

  const showAll = useCallback(() => {
    onSelectView('library');
    onSelectCategory(null);
    onSelectTag(null);
  }, [onSelectView, onSelectCategory, onSelectTag]);

  const showReview = useCallback(() => onSelectView('review'), [onSelectView]);

  const expand = useCallback(() => onSetCollapsed(false), [onSetCollapsed]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: collapsed ? SIDEBAR_RAIL_WIDTH : width,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setPreviewWidth(dragRef.current.startWidth);
      event.preventDefault();
    },
    [collapsed, width, setPreviewWidth],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const raw = drag.startWidth + (event.clientX - drag.startX);
      setPreviewWidth(
        Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_RAIL_WIDTH, raw)),
      );
    },
    [setPreviewWidth],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      const raw = dragWidthRef.current ?? drag.startWidth;
      setPreviewWidth(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (raw < SIDEBAR_MIN_WIDTH) {
        onSetCollapsed(true);
      } else {
        onSetCollapsed(false);
        onSetWidth(raw);
      }
    },
    [onSetCollapsed, onSetWidth, setPreviewWidth],
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const current = collapsed ? SIDEBAR_RAIL_WIDTH : width;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const next = current - 16;
        if (next < SIDEBAR_MIN_WIDTH) {
          onSetCollapsed(true);
        } else {
          onSetCollapsed(false);
          onSetWidth(next);
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        const next = current + 16;
        if (next >= SIDEBAR_MIN_WIDTH) {
          onSetCollapsed(false);
          onSetWidth(next);
        }
      } else if (event.key === 'Home') {
        event.preventDefault();
        onSetCollapsed(false);
        onSetWidth(SIDEBAR_DEFAULT_WIDTH);
      }
    },
    [collapsed, width, onSetCollapsed, onSetWidth],
  );

  const resizeHandle = (
    /* eslint-disable jsx-a11y/prefer-tag-over-role -- <hr> cannot be a focusable, keyboard-operable separator */
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleResizeKeyDown}
      className="absolute inset-y-0 -right-1 z-10 w-1 cursor-ew-resize touch-none after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-border after:opacity-0 after:transition-opacity after:duration-150 hover:after:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:after:opacity-100"
    />
    /* eslint-enable jsx-a11y/prefer-tag-over-role */
  );

  return (
    <aside
      style={asideStyle}
      className={cn(
        'relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        effectiveCollapsed && 'items-center gap-1 py-3',
        dragWidth === null && 'transition-[width] duration-200 ease-in-out motion-reduce:transition-none',
      )}
    >
      {effectiveCollapsed ? (
        <>
          <RailButton label="Expand sidebar" onClick={onToggleCollapse}>
            <PanelLeftOpenIcon />
          </RailButton>

          <div className="mt-2 flex flex-col items-center gap-1">
            <RailButton
              label={`All bookmarks (${aggregates?.total ?? 0})`}
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
            <RailButton
              label={`Categories (${categories.length})`}
              active={view === 'library' && selectedCategoryId !== null}
              onClick={expand}
            >
              <FolderOpenIcon />
            </RailButton>
            <RailButton
              label={`Tags (${tags.length})`}
              active={view === 'library' && selectedTagId !== null}
              onClick={expand}
            >
              <HashIcon />
            </RailButton>
          </div>

          <div className="mt-auto flex flex-col items-center gap-1">
            <RailButton label="Import" onClick={onNavigateImport}>
              <UploadIcon />
            </RailButton>
            <RailButton label="Vocabulary" onClick={onNavigateVocabulary}>
              <TagsIcon />
            </RailButton>
            <SidebarAccountMenu profile={profile} theme={theme} onThemeChange={onThemeChange} />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
            <span className="text-sm font-semibold tracking-tight">al-yo-bo</span>
            <Badge variant="secondary" className="ml-auto tabular-nums">
              {aggregates?.total ?? 0}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse sidebar"
              onClick={onToggleCollapse}
            >
              <PanelLeftCloseIcon />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <SidebarNav
              aggregates={aggregates}
              profile={profile}
              theme={theme}
              view={view}
              selectedCategoryId={selectedCategoryId}
              selectedTagId={selectedTagId}
              reviewCount={reviewCount}
              openSections={openSections}
              onSetOpenSection={onSetOpenSection}
              onSelectView={onSelectView}
              onSelectCategory={onSelectCategory}
              onSelectTag={onSelectTag}
              onThemeChange={onThemeChange}
              onNavigateImport={onNavigateImport}
              onNavigateVocabulary={onNavigateVocabulary}
              showTools={false}
            />
          </ScrollArea>

          <div className="border-t border-sidebar-border px-2 py-2">
            <SidebarTools
              profile={profile}
              theme={theme}
              onThemeChange={onThemeChange}
              onNavigateImport={onNavigateImport}
              onNavigateVocabulary={onNavigateVocabulary}
            />
          </div>
        </>
      )}

      {resizeHandle}
    </aside>
  );
}

export { SidebarNav };
