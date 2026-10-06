import type { Aggregates, CategoryNode, Profile } from '@al-yo-bo/shared';
import {
  ChevronRightIcon,
  DownloadIcon,
  FolderIcon,
  FolderOpenIcon,
  HashIcon,
  InboxIcon,
  LibraryBigIcon,
  PanelLeftCloseIcon,
  QrCodeIcon,
  TagsIcon,
  UploadIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { CollapsibleSection } from '@/components/CollapsibleSection';
import { FilterTagPill } from '@/components/FilterTagPill';
import { SidebarAccountMenu } from '@/components/SidebarAccountMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCategoryDropHandler } from '@/hooks/useCategoryMutations';
import { useSidebarNavModel } from '@/hooks/useSidebarNavModel';
import { dropPositionFromEvent } from '@/lib/categories';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from '@/lib/useSidebar';
import type { Theme } from '@/lib/useTheme';
import { cn } from '@/lib/utils';

/** Keys used in the persisted `ayb:sidebar:sections` open/closed map. */
const navGroupKey = (id: string) => `section:${id}`;
const TAGS_KEY = 'tags';

interface SidebarNavProps {
  tree: CategoryNode[];
  aggregates: Aggregates | null;
  profile: Profile | null;
  theme: Theme;
  selectedCategoryId: string | null;
  selectedTagId: string | null;
  openSections: Record<string, boolean>;
  onSetOpenSection: (key: string, open: boolean) => void;
  onSelectCategory: (id: string | null) => void;
  onSelectTag: (id: string | null) => void;
  onThemeChange: (theme: Theme) => void;
  onNavigateImport: () => void;
  onNavigateExport: () => void;
  onNavigateVocabulary: () => void;
  onNavigateShare: () => void;
  onNavigateProfile: () => void;
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

// Active nav entries use sidebar-accent so the selected state stays on the
// sidebar surface palette (DESIGN.md §Sidebar).
const rowClass =
  'w-full justify-start gap-2 px-2 font-normal data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground';

interface NavSelectionProps {
  onSelectCategory: (id: string | null) => void;
  onSelectTag: (id: string | null) => void;
  onNavigate?: () => void;
}

/**
 * Drag-and-drop context for the category tree: the dragged id lives at the
 * nav level so a row only needs its own identity to behave as a drop target.
 * Native HTML5 DnD — no dependency — with a three-zone drop semantics
 * (before / into / after, see `dropPositionFromEvent`).
 */
interface TreeDndContextValue {
  dragId: string | null;
  startDrag: (id: string) => void;
  endDrag: () => void;
  drop: (dragId: string, targetId: string, position: 'before' | 'after' | 'into') => void;
}

const TreeDndContext = createContext<TreeDndContextValue>({
  dragId: null,
  startDrag: () => {},
  endDrag: () => {},
  drop: () => {},
});

interface CategoryTreeRowProps {
  node: CategoryNode;
  depth: number;
  counts: Map<string, number>;
  selectedCategoryId: string | null;
  openSections: Record<string, boolean>;
  onSetOpenSection: (key: string, open: boolean) => void;
  hover: { id: string; position: 'before' | 'after' | 'into' } | null;
  onHover: (hover: { id: string; position: 'before' | 'after' | 'into' } | null) => void;
  selection: NavSelectionProps;
}

/** Drop-highlight classes per zone: a 1px guide line for reorder, a tint for nest-into. */
function dropIndicatorClass(
  hover: { id: string; position: 'before' | 'after' | 'into' } | null,
  id: string,
): string {
  if (!hover || hover.id !== id) {
    return '';
  }
  if (hover.position === 'before') {
    return 'before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:bg-primary before:content-[""]';
  }
  if (hover.position === 'after') {
    return 'before:absolute before:inset-x-1 before:bottom-0 before:h-0.5 before:bg-primary before:content-[""]';
  }
  return 'bg-sidebar-accent/60';
}

/** One category entry with its collapsible children; also an HTML5 drop target. */
function CategoryTreeRow({
  node,
  depth,
  counts,
  selectedCategoryId,
  openSections,
  onSetOpenSection,
  hover,
  onHover,
  selection,
}: CategoryTreeRowProps) {
  const dnd = useContext(TreeDndContext);
  const hasChildren = node.children.length > 0;
  const open = openSections[navGroupKey(node.id)] ?? true;
  const active = selectedCategoryId === node.id;
  const count = counts.get(node.id) ?? 0;
  const isDragging = dnd.dragId === node.id;

  const handleSelect = useCallback(() => {
    selection.onSelectTag(null);
    selection.onSelectCategory(selectedCategoryId === node.id ? null : node.id);
    selection.onNavigate?.();
  }, [selection, selectedCategoryId, node.id]);

  const toggleOpen = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onSetOpenSection(navGroupKey(node.id), !open);
    },
    [onSetOpenSection, open, node.id],
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.id);
      dnd.startDrag(node.id);
    },
    [dnd, node.id],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!dnd.dragId || dnd.dragId === node.id) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      onHover({ id: node.id, position: dropPositionFromEvent(event) });
    },
    [dnd.dragId, node.id, onHover],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const dragId = dnd.dragId;
      onHover(null);
      dnd.endDrag();
      if (!dragId || dragId === node.id) {
        return;
      }
      dnd.drop(dragId, node.id, dropPositionFromEvent(event));
    },
    [dnd, node.id, onHover],
  );

  const handleDragLeave = useCallback(() => onHover(null), [onHover]);

  return (
    <div className="relative" data-category-id={node.id}>
      <div
        className={cn(
          'relative transition-colors duration-150',
          dropIndicatorClass(hover, node.id),
          isDragging && 'opacity-40',
        )}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={dnd.endDrag}
      >
        <div className={cn('flex items-center gap-0.5', depth > 0 && 'pl-4')}>
          {hasChildren ? (
            <button
              type="button"
              aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
              aria-expanded={open}
              onClick={toggleOpen}
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRightIcon
                className={cn(
                  'size-3.5 transition-transform duration-150',
                  open && 'rotate-90',
                )}
              />
            </button>
          ) : (
            <span className="size-6 shrink-0" aria-hidden />
          )}
          <Button
            variant="ghost"
            className={cn(rowClass, 'min-w-0 flex-1')}
            data-active={active}
            onClick={handleSelect}
          >
            {open && hasChildren ? <FolderOpenIcon /> : <FolderIcon />}
            <span className="truncate">{node.name}</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span>
          </Button>
        </div>
      </div>

      {hasChildren && open && (
        <div className="ml-4 flex flex-col border-l-2 border-border/60">
          {node.children.map((child) => (
            <CategoryTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              counts={counts}
              selectedCategoryId={selectedCategoryId}
              openSections={openSections}
              onSetOpenSection={onSetOpenSection}
              hover={hover}
              onHover={onHover}
              selection={selection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DropToRootProps {
  active: boolean;
  onDropToRoot: () => void;
}

/**
 * Root-level drop strip, visible only while a row is dragged: dropping here
 * moves the category to the top level (appended after the roots). A plain
 * div on purpose — drag targets are not interactive controls, so neither a
 * role nor focus semantics apply.
 */
function DropToRoot({ active, onDropToRoot }: DropToRootProps) {
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      onDropToRoot();
    },
    [onDropToRoot],
  );

  if (!active) {
    return null;
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="mt-1 flex items-center justify-center rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground"
    >
      Drop to move to top level
    </div>
  );
}

interface CategoryTreeProps extends NavSelectionProps {
  tree: CategoryNode[];
  counts: Map<string, number>;
  selectedCategoryId: string | null;
  openSections: Record<string, boolean>;
  onSetOpenSection: (key: string, open: boolean) => void;
}

/** The whole category tree with drag-reorder; owns the shared drag state. */
function CategoryTree({
  tree,
  counts,
  selectedCategoryId,
  openSections,
  onSetOpenSection,
  onSelectCategory,
  onSelectTag,
  onNavigate,
}: CategoryTreeProps) {
  const { handleDrop, handleDropToRoot } = useCategoryDropHandler();
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; position: 'before' | 'after' | 'into' } | null>(
    null,
  );

  const endDrag = useCallback(() => {
    setDragId(null);
    setHover(null);
  }, []);

  // Closes over the tree prop so a drop always reads the optimistic shape
  // (the mutation re-renders this component with the predicted tree).
  const drop = useCallback(
    (drag: string, target: string, position: 'before' | 'after' | 'into') => {
      handleDrop(tree, drag, target, position);
    },
    [handleDrop, tree],
  );

  const dnd = useMemo<TreeDndContextValue>(
    () => ({ dragId, startDrag: setDragId, endDrag, drop }),
    [dragId, endDrag, drop],
  );

  const onDropToRoot = useCallback(() => {
    if (dragId) {
      handleDropToRoot(tree, dragId);
    }
    endDrag();
  }, [dragId, handleDropToRoot, tree, endDrag]);

  const selection = useMemo<NavSelectionProps>(
    () => ({ onSelectCategory, onSelectTag, onNavigate }),
    [onSelectCategory, onSelectTag, onNavigate],
  );

  return (
    <TreeDndContext.Provider value={dnd}>
      <div className="flex flex-col">
        {tree.map((node) => (
          <CategoryTreeRow
            key={node.id}
            node={node}
            depth={0}
            counts={counts}
            selectedCategoryId={selectedCategoryId}
            openSections={openSections}
            onSetOpenSection={onSetOpenSection}
            hover={hover}
            onHover={setHover}
            selection={selection}
          />
        ))}
        <DropToRoot active={dragId !== null} onDropToRoot={onDropToRoot} />
      </div>
    </TreeDndContext.Provider>
  );
}

interface CollapsibleGroupProps {
  storageKey: string;
  title: string;
  count?: number;
  open: boolean;
  onSetOpenSection: (key: string, open: boolean) => void;
  children: ReactNode;
}

/** Thin adapter that keeps the CollapsibleSection open handler stable per group. */
function CollapsibleGroup({
  storageKey,
  title,
  count,
  open,
  onSetOpenSection,
  children,
}: CollapsibleGroupProps) {
  const handleOpenChange = useCallback(
    (next: boolean) => onSetOpenSection(storageKey, next),
    [onSetOpenSection, storageKey],
  );

  return (
    <CollapsibleSection title={title} count={count} open={open} onOpenChange={handleOpenChange}>
      {children}
    </CollapsibleSection>
  );
}

interface SidebarToolsProps {
  onNavigateImport: () => void;
  onNavigateExport: () => void;
  onNavigateVocabulary: () => void;
  onNavigateShare: () => void;
  onNavigate?: () => void;
}

/** Tools block (DESIGN.md §Sidebar info architecture): Import, Export, Vocabulary, Share. */
function SidebarTools({
  onNavigateImport,
  onNavigateExport,
  onNavigateVocabulary,
  onNavigateShare,
  onNavigate,
}: SidebarToolsProps) {
  const handleImport = useCallback(() => {
    onNavigateImport();
    onNavigate?.();
  }, [onNavigateImport, onNavigate]);

  const handleExport = useCallback(() => {
    onNavigateExport();
    onNavigate?.();
  }, [onNavigateExport, onNavigate]);

  const handleVocabulary = useCallback(() => {
    onNavigateVocabulary();
    onNavigate?.();
  }, [onNavigateVocabulary, onNavigate]);

  const handleShare = useCallback(() => {
    onNavigateShare();
    onNavigate?.();
  }, [onNavigateShare, onNavigate]);

  return (
    <div className="flex flex-col gap-0.5">
      <Button variant="ghost" className={rowClass} onClick={handleImport}>
        <UploadIcon />
        <span>Import</span>
      </Button>
      <Button variant="ghost" className={rowClass} onClick={handleExport}>
        <DownloadIcon />
        <span>Export</span>
      </Button>
      <Button variant="ghost" className={rowClass} onClick={handleVocabulary}>
        <TagsIcon />
        <span>Vocabulary</span>
      </Button>
      <Button variant="ghost" className={rowClass} onClick={handleShare}>
        <QrCodeIcon />
        <span>Share</span>
      </Button>
    </div>
  );
}

/** Shared nav body: identical content in the persistent sidebar and the mobile sheet. */
function SidebarNav({
  tree,
  aggregates,
  selectedCategoryId,
  selectedTagId,
  openSections,
  onSetOpenSection,
  onSelectCategory,
  onSelectTag,
  onNavigateImport,
  onNavigateExport,
  onNavigateVocabulary,
  onNavigateShare,
  onNavigate,
  showTools = true,
}: SidebarNavProps) {
  const model = useSidebarNavModel(tree, aggregates, selectedCategoryId, selectedTagId);

  const showAll = useCallback(() => {
    onSelectCategory(null);
    onSelectTag(null);
    onNavigate?.();
  }, [onSelectCategory, onSelectTag, onNavigate]);

  const toggleTag = useCallback(
    (id: string) => {
      onSelectCategory(null);
      onSelectTag(selectedTagId === id ? null : id);
      onNavigate?.();
    },
    [onSelectCategory, onSelectTag, selectedTagId, onNavigate],
  );

  const hasCategories = tree.length > 0;

  return (
    <nav className="flex flex-col gap-1 px-2 pb-4">
      <Button
        variant="ghost"
        className={rowClass}
        data-active={model.isAllActive}
        onClick={showAll}
      >
        <InboxIcon />
        <span>All bookmarks</span>
        <NavCount>{model.total}</NavCount>
      </Button>

      {hasCategories && (
        <CollapsibleGroup
          storageKey={navGroupKey('categories')}
          title="Categories"
          count={tree.length}
          open={openSections[navGroupKey('categories')] ?? true}
          onSetOpenSection={onSetOpenSection}
        >
          <CategoryTree
            tree={tree}
            counts={model.categoryCounts}
            selectedCategoryId={selectedCategoryId}
            openSections={openSections}
            onSetOpenSection={onSetOpenSection}
            onSelectCategory={onSelectCategory}
            onSelectTag={onSelectTag}
            onNavigate={onNavigate}
          />
        </CollapsibleGroup>
      )}

      <CollapsibleGroup
        storageKey={TAGS_KEY}
        title="Tags"
        count={model.tagCount}
        open={openSections[TAGS_KEY] ?? true}
        onSetOpenSection={onSetOpenSection}
      >
        <div className="flex flex-wrap gap-1.5 p-2">
          {model.tags.map((tag) => (
            <FilterTagPill
              key={tag.id}
              id={tag.id}
              name={tag.name}
              count={tag.count}
              selected={selectedTagId === tag.id}
              size="md"
              onToggle={toggleTag}
            />
          ))}
        </div>
      </CollapsibleGroup>

      {showTools && (
        <div className="mt-4 border-t border-sidebar-border pt-2">
          <SidebarTools
            onNavigateImport={onNavigateImport}
            onNavigateExport={onNavigateExport}
            onNavigateVocabulary={onNavigateVocabulary}
            onNavigateShare={onNavigateShare}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </nav>
  );
}

interface NavCountProps {
  children: ReactNode;
  /** Corner badge for icon rail; inline badge for expanded rows. */
  corner?: boolean;
}

/** Shared count renderer: secondary inline in expanded rows, primary corner in the rail. */
function NavCount({ children, corner }: NavCountProps) {
  if (corner) {
    return (
      <span className="absolute top-0 right-0 flex h-4 min-w-4 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-medium text-primary-foreground tabular-nums">
        {children}
      </span>
    );
  }
  return (
    <Badge variant="secondary" className="ml-auto tabular-nums">
      {children}
    </Badge>
  );
}

interface RailButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  badge?: number;
  active?: boolean;
}

/** Icon-rail entry with a tooltip. */
function RailButton({ label, onClick, children, badge, active }: RailButtonProps) {
  const triggerRender = useMemo(
    () => (
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={label}
        aria-pressed={active}
        data-active={active}
        className="relative data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
        onClick={onClick}
      />
    ),
    [active, label, onClick],
  );

  return (
    <Tooltip>
      <TooltipTrigger render={triggerRender}>
        {children}
        {badge !== undefined && badge > 0 && <NavCount corner>{badge}</NavCount>}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({
  tree,
  aggregates,
  profile,
  theme,
  selectedCategoryId,
  selectedTagId,
  openSections,
  onSetOpenSection,
  onSelectCategory,
  onSelectTag,
  onThemeChange,
  onNavigateImport,
  onNavigateExport,
  onNavigateVocabulary,
  onNavigateShare,
  onNavigateProfile,
  collapsed,
  width,
  onToggleCollapse,
  onSetWidth,
  onSetCollapsed,
}: SidebarProps) {
  const model = useSidebarNavModel(tree, aggregates, selectedCategoryId, selectedTagId);

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
    onSelectCategory(null);
    onSelectTag(null);
  }, [onSelectCategory, onSelectTag]);

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
            <LibraryBigIcon />
          </RailButton>

          <div className="mt-2 flex flex-col items-center gap-1">
            <SidebarAccountMenu
              profile={profile}
              onNavigateProfile={onNavigateProfile}
              size="icon-lg"
            />
            <ThemeToggle
              theme={theme}
              onThemeChange={onThemeChange}
              size="icon-lg"
            />
          </div>

          <div className="mt-2 flex flex-col items-center gap-1">
            <RailButton
              label={`All bookmarks (${model.total})`}
              active={model.isAllActive}
              onClick={showAll}
            >
              <InboxIcon />
            </RailButton>
            <RailButton
              label="Categories"
              active={model.isCategoryActive}
              onClick={expand}
            >
              <FolderIcon />
            </RailButton>
            <RailButton
              label={`Tags (${model.tagCount})`}
              active={model.isTagActive}
              onClick={expand}
            >
              <HashIcon />
            </RailButton>
          </div>

          <div className="mt-auto flex flex-col items-center gap-1">
            <RailButton label="Import" onClick={onNavigateImport}>
              <UploadIcon />
            </RailButton>
            <RailButton label="Export" onClick={onNavigateExport}>
              <DownloadIcon />
            </RailButton>
            <RailButton label="Vocabulary" onClick={onNavigateVocabulary}>
              <TagsIcon />
            </RailButton>
            <RailButton label="Share" onClick={onNavigateShare}>
              <QrCodeIcon />
            </RailButton>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-3 py-3 sm:px-4">
            <LibraryBigIcon className="size-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate text-sm font-semibold whitespace-nowrap tracking-tight">
              al-yo-bo
            </span>
            <Badge variant="secondary" className="tabular-nums">
              {model.total}
            </Badge>
            <div className="ml-auto flex items-center gap-0.5">
              <SidebarAccountMenu
                profile={profile}
                onNavigateProfile={onNavigateProfile}
              />
              <ThemeToggle
                theme={theme}
                onThemeChange={onThemeChange}
                size="icon-sm"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse sidebar"
                onClick={onToggleCollapse}
              >
                <PanelLeftCloseIcon />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <SidebarNav
              tree={tree}
              aggregates={aggregates}
              profile={profile}
              theme={theme}
              selectedCategoryId={selectedCategoryId}
              selectedTagId={selectedTagId}
              openSections={openSections}
              onSetOpenSection={onSetOpenSection}
              onSelectCategory={onSelectCategory}
              onSelectTag={onSelectTag}
              onThemeChange={onThemeChange}
              onNavigateImport={onNavigateImport}
              onNavigateExport={onNavigateExport}
              onNavigateVocabulary={onNavigateVocabulary}
              onNavigateShare={onNavigateShare}
              onNavigateProfile={onNavigateProfile}
              showTools={false}
            />
          </ScrollArea>

          <div className="border-t border-sidebar-border px-2 py-2">
            <SidebarTools
              onNavigateImport={onNavigateImport}
              onNavigateExport={onNavigateExport}
              onNavigateVocabulary={onNavigateVocabulary}
              onNavigateShare={onNavigateShare}
            />
          </div>
        </>
      )}

      {resizeHandle}
    </aside>
  );
}

export { SidebarNav };
export type { SidebarNavProps };
