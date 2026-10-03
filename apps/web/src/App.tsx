import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookmarkListStatus,
  BookmarkSort,
  BookmarkWithTags,
  Category,
  ReviewCandidate,
  SearchMode,
  Section,
  Tag,
} from '@al-yo-bo/shared';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AddBookmarkSheet } from '@/components/AddBookmarkSheet';
import { BookmarkDetailSheet } from '@/components/BookmarkDetailSheet';
import { BookmarkList } from '@/components/BookmarkList';
import { ClassifierSuggestions } from '@/components/ClassifierSuggestions';
import { CommandPalette } from '@/components/CommandPalette';
import { ImportPage } from '@/components/ImportPage';
import { ResultsToolbar } from '@/components/ResultsToolbar';
import { SharePage } from '@/components/SharePage';
import { Sidebar, SidebarNav } from '@/components/Sidebar';
import { SidebarAccountMenu } from '@/components/SidebarAccountMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Topbar } from '@/components/Topbar';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { VocabularyPage } from '@/components/VocabularyPage';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  acceptCandidate,
  deleteBookmark,
  fetchAggregates,
  fetchBookmarks,
  fetchCategories,
  fetchProfile,
  fetchReviewCandidates,
  fetchSections,
  fetchTags,
} from '@/lib/client';
import { navigate, useRoute } from '@/lib/router';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/queryKeys';
import { useLayout } from '@/lib/useLayout';
import type { Layout } from '@/lib/useLayout';
import { useSidebar } from '@/lib/useSidebar';
import { useTheme } from '@/lib/useTheme';
import { addRecentQuery, getRecentQueries } from '@/lib/recent-queries';

const PAGE_SIZE = 20;
type View = 'library' | 'review';

// Stable empty fallbacks: passing a fresh [] as a prop would defeat prop-identity
// memoization in the list components on every render.
const NO_ITEMS: BookmarkWithTags[] = [];
const NO_CATEGORIES: Category[] = [];
const NO_SECTIONS: Section[] = [];
const NO_TAGS: Tag[] = [];
const NO_CANDIDATES: ReviewCandidate[] = [];

interface BookmarkListCrossfadeProps {
  page: number;
  listKey: string;
  isPlaceholderData: boolean;
  loading: boolean;
  layout: Layout;
  filtered: boolean;
  items: BookmarkWithTags[];
  onOpen: (bookmark: BookmarkWithTags) => void;
  onDelete: (bookmark: BookmarkWithTags) => void;
  onAdd: () => void;
  onImport: () => void;
  onClearFilters: () => void;
  selectedTagId: string | null;
  onTagClick: (tagId: string) => void;
}

/**
 * Crossfade the library list on page changes (150 ms, opacity only).
 *
 * Two stable slots are swapped instead of keying on `page`, so a parallel lane's
 * mount-only card entrance stagger inside BookmarkList is not re-triggered on
 * every pagination event. Items are cached per page so the outgoing slot keeps
 * its content while the incoming slot waits for fresh data.
 */
function BookmarkListCrossfade({
  page,
  listKey,
  isPlaceholderData,
  loading,
  layout,
  filtered,
  items,
  onOpen,
  onDelete,
  onAdd,
  onImport,
  onClearFilters,
  selectedTagId,
  onTagClick,
}: BookmarkListCrossfadeProps) {
  const [activeSlot, setActiveSlot] = useState(0);
  const [slots, setSlots] = useState<
    { page: number; items: BookmarkWithTags[] | undefined }[]
  >([
    { page, items },
    { page, items },
  ]);
  const cacheRef = useRef<Record<number, BookmarkWithTags[]>>({ [page]: items });
  const lastListKeyRef = useRef(listKey);
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // When filters change the page number is reset, and page-cache entries from
  // the old filter set would be misleading. Reset to a single slot showing the
  // current filter results.
  useEffect(() => {
    if (listKey === lastListKeyRef.current) {
      return;
    }
    lastListKeyRef.current = listKey;
    cacheRef.current = items.length > 0 ? { [page]: items } : {};
    setSlots([
      { page, items },
      { page, items },
    ]);
    setActiveSlot(0);
  }, [listKey, page, items]);

  // Keep the cache and the active slot in sync with live query data.
  useEffect(() => {
    if (!isPlaceholderData) {
      cacheRef.current[page] = items;
    }
    setSlots((prev) =>
      prev.map((slot) =>
        slot.page === page
          ? { ...slot, items: isPlaceholderData ? slot.items : items }
          : slot,
      ),
    );
  }, [items, page, isPlaceholderData]);

  // Start the crossfade when the user moves to a different page.
  useEffect(() => {
    const currentSlot = slots[activeSlot];
    if (!currentSlot || page === currentSlot.page) {
      return;
    }
    const nextSlot = activeSlot === 0 ? 1 : 0;
    setSlots((prev) => {
      const next = [...prev];
      next[nextSlot] = { page, items: cacheRef.current[page] };
      return next;
    });
    if (prefersReducedMotion) {
      setActiveSlot(nextSlot);
      return;
    }
    const timer = setTimeout(() => {
      setActiveSlot(nextSlot);
    }, 150);
    return () => clearTimeout(timer);
  }, [page, activeSlot, prefersReducedMotion]);

  return (
    <div className="relative min-h-0 flex-1">
      {slots.map((slot, index) => {
        const isActive = activeSlot === index;
        const slotLoading = slot.items === undefined || (isActive && loading);
        return (
          <div
            key={index === 0 ? 'crossfade-a' : 'crossfade-b'}
            className={cn(
              'absolute inset-0 transition-opacity duration-150 ease-out motion-reduce:transition-none',
              isActive ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            aria-hidden={!isActive}
          >
            <BookmarkList
              items={slot.items ?? NO_ITEMS}
              loading={slotLoading}
              layout={layout}
              filtered={filtered}
              onOpen={onOpen}
              onDelete={onDelete}
              onAdd={onAdd}
              onImport={onImport}
              onClearFilters={onClearFilters}
              selectedTagId={selectedTagId}
              onTagClick={onTagClick}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Chat pulls the AI SDK + beui + motion; keep all of it out of the initial bundle. */
const ChatPanel = lazy(() =>
  import('@/components/ChatPanel').then((module) => ({ default: module.ChatPanel })),
);

/** Panel-shaped placeholder while the chat chunk streams in. */
function ChatSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 p-4" aria-hidden>
      <Skeleton className="h-10 w-3/4 rounded-lg" />
      <Skeleton className="ml-auto h-8 w-2/3 rounded-lg" />
      <Skeleton className="h-14 w-5/6 rounded-lg" />
      <Skeleton className="mt-auto h-9 w-full rounded-lg" />
    </div>
  );
}

// Module scope: a fresh <ChatSkeleton /> prop would break element identity
// (and remount the fallback) on every App render.
const CHAT_FALLBACK = <ChatSkeleton />;

function ChatSurface() {
  return (
    <Suspense fallback={CHAT_FALLBACK}>
      <ChatPanel />
    </Suspense>
  );
}

export function App() {
  const route = useRoute();
  const [view, setView] = useState<View>('library');
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('keyword');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [status, setStatus] = useState<BookmarkListStatus>('active');
  const [sort, setSort] = useState<BookmarkSort>('created_at');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const [layout, setLayout] = useLayout();
  const [theme, setTheme] = useTheme();
  const {
    width: sidebarWidth,
    collapsed: sidebarCollapsed,
    openSections,
    setWidth: setSidebarWidth,
    setCollapsed: setSidebarCollapsed,
    toggleCollapsed: toggleSidebar,
    setOpenSection: setSidebarOpenSection,
  } = useSidebar();

  const [selected, setSelected] = useState<BookmarkWithTags | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BookmarkWithTags | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(getRecentQueries);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const isTablet = useMediaQuery('(min-width: 768px)');

  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(query);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // base-ui marks every open popup/sheet/dialog with `data-open`; don't
      // let `/` or `c` fire while any overlay has focus.
      const overlayOpen =
        document.querySelector(
          '[data-slot="sheet-popup"][data-open], ' +
            '[data-slot="alert-dialog-popup"][data-open], ' +
            '[data-slot="command-dialog-popup"][data-open], ' +
            '[data-slot="popover-content"][data-open], ' +
            '[data-slot="dropdown-menu-content"][data-open], ' +
            '[data-slot="dropdown-menu-sub-content"][data-open], ' +
            '[data-slot="select-popup"][data-open]',
        ) !== null;

      // Cmd/Ctrl+K toggles the command palette even while the user is typing
      // in an input, so it must be checked before the typing guard.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }

      // Cmd/Ctrl+B toggles the sidebar even while typing, same reason as Cmd+K.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (event.key === '/' && !typing && !overlayOpen) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (
        event.key === 'c' &&
        !typing &&
        !overlayOpen &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setChatOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        // Close the topmost overlay on each press: sheets first, then the
        // command palette, then the chat panel.
        if (addOpen) {
          setAddOpen(false);
          return;
        }
        if (selected) {
          setSelected(null);
          return;
        }
        if (navOpen) {
          setNavOpen(false);
          return;
        }
        if (commandOpen) {
          setCommandOpen(false);
          return;
        }
        if (chatOpen) {
          setChatOpen(false);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addOpen, chatOpen, commandOpen, navOpen, selected, toggleSidebar]);

  // A page change renders a fresh batch; don't leave the user scrolled mid-list.
  useEffect(() => {
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  const bookmarkParams = {
    q: searchQuery || undefined,
    mode,
    categoryId: categoryId ?? undefined,
    tagId: tagId ?? undefined,
    status,
    sort,
    direction,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  // Stable key for the crossfade cache. Any change that resets pagination also
  // invalidates the cached page items.
  const listKey = useMemo(
    () =>
      JSON.stringify({
        mode,
        categoryId,
        tagId,
        status,
        sort,
        direction,
        q: searchQuery,
      }),
    [mode, categoryId, tagId, status, sort, direction, searchQuery],
  );

  // keepPreviousData shows the outgoing page while the next one loads, so
  // pagination doesn't flash a skeleton list; stale responses can never
  // overwrite a newer one because each param set is its own cache entry.
  const bookmarksQuery = useQuery({
    queryKey: queryKeys.bookmarks.list(bookmarkParams),
    queryFn: () => fetchBookmarks(bookmarkParams),
    placeholderData: keepPreviousData,
  });

  const aggregatesQuery = useQuery({
    queryKey: queryKeys.aggregates,
    queryFn: fetchAggregates,
  });
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: fetchCategories,
  });
  const sectionsQuery = useQuery({
    queryKey: queryKeys.sections,
    queryFn: fetchSections,
  });
  const tagsQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: fetchTags,
  });
  const candidatesQuery = useQuery({
    queryKey: queryKeys.candidates,
    queryFn: fetchReviewCandidates,
  });
  const profileQuery = useQuery({
    queryKey: queryKeys.profile,
    queryFn: fetchProfile,
  });

  const aggregates = aggregatesQuery.data ?? null;
  const profile = profileQuery.data ?? null;
  const categories = categoriesQuery.data ?? NO_CATEGORIES;
  const sections = sectionsQuery.data ?? NO_SECTIONS;
  const tags = tagsQuery.data ?? NO_TAGS;
  const candidates = candidatesQuery.data ?? NO_CANDIDATES;

  // Generic refresh (toolbar button, new bookmark created): list + counts.
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
  }, [queryClient]);

  // Detail dialog edits (tag add/remove, save, scrape) touch the list and
  // counts; inline tag creation adds vocabulary, so the tags query joins in.
  const onDetailChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  }, [queryClient]);

  // Deletes also remove a bookmark's review candidates and its tag aggregates.
  const invalidateAfterDelete = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
    void queryClient.invalidateQueries({ queryKey: queryKeys.candidates });
  }, [queryClient]);

  // Accepting a candidate assigns the tag and consumes the suggestion.
  const onAccept = useCallback(
    async (candidate: ReviewCandidate) => {
      try {
        await acceptCandidate(candidate.bookmarkId, candidate.tagId);
        toast.success('Candidate accepted');
        void queryClient.invalidateQueries({ queryKey: queryKeys.candidates });
        void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to accept candidate');
      }
    },
    [queryClient],
  );

  // Vocabulary edits change tag/category/section data; status flips (e.g. a tag
  // going inactive) also affect bookmark lists and aggregates.
  const onVocabChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
    void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sections });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.aggregates });
  }, [queryClient]);

  // An import can create bookmarks, categories, sections, and tags at once.
  const onImportCommitted = useCallback(() => {
    setView('library');
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const openAdd = useCallback(() => setAddOpen(true), []);
  const openNav = useCallback(() => setNavOpen(true), []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleChat = useCallback(() => setChatOpen((open) => !open), []);
  const goImport = useCallback(() => navigate('import'), []);
  const goVocabulary = useCallback(() => navigate('vocabulary'), []);
  const goShare = useCallback(() => navigate('share'), []);

  const onModeChange = useCallback((next: SearchMode) => {
    setMode(next);
    setPage(0);
  }, []);

  const onSelectCategory = useCallback((id: string | null) => {
    setCategoryId(id);
    setPage(0);
  }, []);

  const onSelectTag = useCallback((id: string | null) => {
    setTagId(id);
    setPage(0);
  }, []);

  // Row tag pills toggle the active tag filter without leaving the library.
  const onTagClick = useCallback((id: string) => {
    setTagId((current) => (current === id ? null : id));
    setPage(0);
  }, []);

  const onSelectView = useCallback((next: View) => {
    setView(next);
    navigate('library');
  }, []);

  const onStatusChange = useCallback((next: BookmarkListStatus) => {
    setStatus(next);
    setPage(0);
  }, []);

  const onSortChange = useCallback((next: BookmarkSort) => {
    setSort(next);
    setPage(0);
  }, []);

  const onDirectionChange = useCallback((next: 'asc' | 'desc') => {
    setDirection(next);
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery('');
    setSearchQuery('');
    setCategoryId(null);
    setTagId(null);
    setStatus('active');
    setPage(0);
  }, []);

  const handlePaletteSearch = useCallback((term: string) => {
    setView('library');
    navigate('library');
    setQuery(term);
    setSearchQuery(term);
    setCategoryId(null);
    setTagId(null);
    setPage(0);
    setRecentQueries(addRecentQuery(term));
  }, []);

  const handleJumpToCategory = useCallback((id: string) => {
    setView('library');
    navigate('library');
    setQuery('');
    setSearchQuery('');
    setCategoryId(id);
    setTagId(null);
    setPage(0);
  }, []);

  const handleJumpToTag = useCallback((id: string) => {
    setView('library');
    navigate('library');
    setQuery('');
    setSearchQuery('');
    setTagId(id);
    setCategoryId(null);
    setPage(0);
  }, []);

  const goPrevPage = useCallback(() => {
    setPage((current) => Math.max(0, current - 1));
  }, []);

  const goNextPage = useCallback(() => {
    setPage((current) => current + 1);
  }, []);

  const closeDetail = useCallback((open: boolean) => {
    if (!open) {
      setSelected(null);
    }
  }, []);

  const closePendingDelete = useCallback((open: boolean) => {
    if (!open) {
      setPendingDelete(null);
    }
  }, []);

  const onDetailDeleted = useCallback(() => {
    setSelected(null);
    invalidateAfterDelete();
  }, [invalidateAfterDelete]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteBookmark(target.id);
      toast.success('Bookmark deleted');
      if (selected?.id === target.id) {
        setSelected(null);
      }
      invalidateAfterDelete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete bookmark');
    }
  }, [pendingDelete, selected, invalidateAfterDelete]);

  const onDeleteConfirmed = useCallback(() => {
    void confirmDelete();
  }, [confirmDelete]);

  const reviewCount = candidates.length;
  const total = bookmarksQuery.data?.total ?? 0;
  const filtered =
    searchQuery !== '' || categoryId !== null || tagId !== null || status !== 'active';

  const sidebarProps = {
    aggregates,
    profile,
    theme,
    view,
    selectedCategoryId: categoryId,
    selectedTagId: tagId,
    reviewCount,
    openSections,
    onSetOpenSection: setSidebarOpenSection,
    // Both library and review live under the library route; picking either
    // from the nav must leave the import page.
    onSelectView,
    onSelectCategory,
    onSelectTag,
    onThemeChange: setTheme,
    onNavigateImport: goImport,
    onNavigateVocabulary: goVocabulary,
    onNavigateShare: goShare,
  };

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {isTablet && (
        <Sidebar
          {...sidebarProps}
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          onToggleCollapse={toggleSidebar}
          onSetWidth={setSidebarWidth}
          onSetCollapsed={setSidebarCollapsed}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          query={query}
          mode={mode}
          searchRef={searchRef}
          chatOpen={chatOpen}
          onQueryChange={setQuery}
          onModeChange={onModeChange}
          onAdd={openAdd}
          onToggleChat={toggleChat}
          onOpenNav={openNav}
        />

        <main className="flex min-h-0 flex-1 gap-3 p-4">
          {route === 'import' ? (
            <ImportPage onCommitted={onImportCommitted} />
          ) : route === 'vocabulary' ? (
            <VocabularyPage
              categories={categories}
              sections={sections}
              onChanged={onVocabChanged}
            />
          ) : route === 'share' ? (
            <SharePage />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                {view === 'library' ? (
                  <>
                    <ResultsToolbar
                      total={total}
                      loading={bookmarksQuery.isFetching}
                      status={status}
                      invalidCount={aggregates?.invalidCount ?? 0}
                      sort={sort}
                      direction={direction}
                      layout={layout}
                      onStatusChange={onStatusChange}
                      onSortChange={onSortChange}
                      onDirectionChange={onDirectionChange}
                      onLayoutChange={setLayout}
                      onRefresh={reload}
                    />

                    <div ref={listScrollRef} className="min-h-0 flex-1 overflow-auto">
                      <BookmarkListCrossfade
                        page={page}
                        listKey={listKey}
                        isPlaceholderData={bookmarksQuery.isPlaceholderData}
                        items={bookmarksQuery.data?.items ?? NO_ITEMS}
                        // Skeleton only until the first page arrives; keepPreviousData
                        // keeps the outgoing page visible during pagination/refetch.
                        loading={bookmarksQuery.isPending}
                        layout={layout}
                        filtered={filtered}
                        onOpen={setSelected}
                        onDelete={setPendingDelete}
                        onAdd={openAdd}
                        onImport={goImport}
                        onClearFilters={clearFilters}
                        selectedTagId={tagId}
                        onTagClick={onTagClick}
                      />
                    </div>

                    {total > PAGE_SIZE && (
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                          {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
                          {total}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={page === 0}
                            onClick={goPrevPage}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!bookmarksQuery.data?.pagination.hasMore}
                            onClick={goNextPage}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <ClassifierSuggestions
                      candidates={candidates}
                      loading={candidatesQuery.isPending}
                      onAccept={onAccept}
                    />
                  </div>
                )}
              </div>

              {chatOpen && isTablet && (
                <aside className="hidden w-[24rem] shrink-0 overflow-hidden rounded-lg border border-border md:block">
                  <ChatSurface />
                </aside>
              )}
            </>
          )}
        </main>
      </div>

      {/* Full navigation, off-canvas below md (topbar menu button). */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetHeader className="flex-row items-center justify-between border-b pr-12">
            <div className="flex flex-col gap-0.5">
              <SheetTitle>al-yo-bo</SheetTitle>
              <SheetDescription>Categories and tags</SheetDescription>
            </div>
            <div className="flex items-center gap-0.5">
              <SidebarAccountMenu
                profile={profile}
                theme={theme}
                onThemeChange={setTheme}
                size="icon-sm"
              />
              <ThemeToggle
                theme={theme}
                onThemeChange={setTheme}
                size="icon-sm"
              />
            </div>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <SidebarNav {...sidebarProps} onNavigate={closeNav} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Chat takes over full-screen below md instead of doing nothing. */}
      <Sheet open={chatOpen && !isTablet} onOpenChange={setChatOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>Chat</SheetTitle>
            <SheetDescription>Ask about your bookmarks</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <ChatSurface />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={closePendingDelete}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bookmark?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.title ?? pendingDelete?.url}” and its tag assignments will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose className={cn(buttonVariants({ variant: "outline" }))}>
              Cancel
            </AlertDialogClose>
            <AlertDialogClose
              onClick={onDeleteConfirmed}
              className={cn(buttonVariants({ variant: "destructive" }))}
            >
              Delete
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddBookmarkSheet
        open={addOpen}
        categories={categories}
        onOpenChange={setAddOpen}
        onCreated={reload}
      />
      <BookmarkDetailSheet
        bookmark={selected}
        categories={categories}
        tags={tags}
        onOpenChange={closeDetail}
        onChanged={onDetailChanged}
        onDeleted={onDetailDeleted}
      />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        categories={categories}
        tags={tags}
        recentQueries={recentQueries}
        onSearch={handlePaletteSearch}
        onJumpToCategory={handleJumpToCategory}
        onJumpToTag={handleJumpToTag}
      />
    </div>
  );
}