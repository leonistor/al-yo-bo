import type {
  Aggregates,
  BookmarkListStatus,
  BookmarkSort,
  BookmarkWithTags,
  Category,
  ReviewCandidate,
  SearchMode,
  SearchResponse,
  Section,
  Tag,
} from '@al-yo-bo/shared';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AddBookmarkDialog } from '@/components/AddBookmarkDialog';
import { BookmarkDetailDialog } from '@/components/BookmarkDetailDialog';
import { BookmarkList } from '@/components/BookmarkList';
import { ImportDialog } from '@/components/ImportDialog';
import { ResultsToolbar } from '@/components/ResultsToolbar';
import { ReviewQueue } from '@/components/ReviewQueue';
import { Sidebar, SidebarNav } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { VocabDialog } from '@/components/VocabDialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  acceptCandidate,
  deleteBookmark,
  fetchAggregates,
  fetchBookmarks,
  fetchCategories,
  fetchReviewCandidates,
  fetchSections,
  fetchTags,
} from '@/lib/client';
import { useLayout } from '@/lib/useLayout';
import { useTheme } from '@/lib/useTheme';

const PAGE_SIZE = 20;
type View = 'library' | 'review';

/** Chat ships assistant-ui + the AI SDK; keep both out of the initial bundle. */
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

function ChatSurface() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatPanel />
    </Suspense>
  );
}

export function App() {
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

  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [bookmarks, setBookmarks] = useState<SearchResponse | null>(null);
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BookmarkWithTags | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BookmarkWithTags | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [vocabOpen, setVocabOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const isTablet = useMediaQuery('(min-width: 768px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

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
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'c' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setChatOpen((open) => !open);
      }
      if (event.key === 'Escape' && chatOpen) {
        setChatOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chatOpen]);

  // A page change renders a fresh batch; don't leave the user scrolled mid-list.
  useEffect(() => {
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  const refreshMeta = useCallback(async () => {
    try {
      const [aggregateData, categoryData, sectionData, tagData, candidateData] = await Promise.all([
        fetchAggregates(),
        fetchCategories(),
        fetchSections(),
        fetchTags(),
        fetchReviewCandidates(),
      ]);
      setAggregates(aggregateData);
      setCategories(categoryData);
      setSections(sectionData);
      setTags(tagData);
      setCandidates(candidateData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load data');
    }
  }, []);

  const refreshResults = useCallback(async () => {
    setLoading(true);
    try {
      setBookmarks(
        await fetchBookmarks({
          q: searchQuery || undefined,
          mode,
          categoryId: categoryId ?? undefined,
          tagId: tagId ?? undefined,
          status,
          sort,
          direction,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load bookmarks');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, mode, categoryId, tagId, status, sort, direction, page]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    void refreshResults();
  }, [refreshResults]);

  const reload = useCallback(() => {
    void refreshMeta();
    void refreshResults();
  }, [refreshMeta, refreshResults]);

  async function accept(candidate: ReviewCandidate) {
    try {
      await acceptCandidate(candidate.bookmarkId, candidate.tagId);
      toast.success('Candidate accepted');
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to accept candidate');
    }
  }

  async function confirmDelete() {
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
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete bookmark');
    }
  }

  function clearFilters() {
    setQuery('');
    setSearchQuery('');
    setCategoryId(null);
    setTagId(null);
    setStatus('active');
    setPage(0);
  }

  const reviewCount = candidates.length;
  const total = bookmarks?.total ?? 0;
  const filtered =
    searchQuery !== '' || categoryId !== null || tagId !== null || status !== 'active';

  const sidebarProps = {
    aggregates,
    view,
    selectedCategoryId: categoryId,
    selectedTagId: tagId,
    reviewCount,
    onSelectView: setView,
    onSelectCategory: (id: string | null) => {
      setCategoryId(id);
      setPage(0);
    },
    onSelectTag: (id: string | null) => {
      setTagId(id);
      setPage(0);
    },
    onManageVocabulary: () => setVocabOpen(true),
  };

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {isDesktop ? (
        <Sidebar {...sidebarProps} />
      ) : isTablet ? (
        <Sidebar {...sidebarProps} variant="rail" onOpenNav={() => setNavOpen(true)} />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          query={query}
          mode={mode}
          theme={theme}
          searchRef={searchRef}
          chatOpen={chatOpen}
          onQueryChange={setQuery}
          onModeChange={(next) => {
            setMode(next);
            setPage(0);
          }}
          onThemeChange={setTheme}
          onAdd={() => setAddOpen(true)}
          onImport={() => setImportOpen(true)}
          onToggleChat={() => setChatOpen((open) => !open)}
          onOpenNav={() => setNavOpen(true)}
        />

        <main className="flex min-h-0 flex-1 gap-3 p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {view === 'library' ? (
              <>
                <ResultsToolbar
                  total={total}
                  loading={loading}
                  status={status}
                  invalidCount={aggregates?.invalidCount ?? 0}
                  sort={sort}
                  direction={direction}
                  layout={layout}
                  onStatusChange={(next) => {
                    setStatus(next);
                    setPage(0);
                  }}
                  onSortChange={(next) => {
                    setSort(next);
                    setPage(0);
                  }}
                  onDirectionChange={(next) => {
                    setDirection(next);
                    setPage(0);
                  }}
                  onLayoutChange={setLayout}
                  onRefresh={reload}
                />

                <div ref={listScrollRef} className="min-h-0 flex-1 overflow-auto">
                  <BookmarkList
                    items={bookmarks?.items ?? []}
                    loading={loading}
                    layout={layout}
                    filtered={filtered}
                    onOpen={setSelected}
                    onDelete={setPendingDelete}
                    onAdd={() => setAddOpen(true)}
                    onImport={() => setImportOpen(true)}
                    onClearFilters={clearFilters}
                  />
                </div>

                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage((current) => Math.max(0, current - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!bookmarks?.pagination.hasMore}
                        onClick={() => setPage((current) => current + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <ReviewQueue candidates={candidates} loading={loading} onAccept={accept} />
              </div>
            )}
          </div>

          {chatOpen && isTablet && (
            <aside className="hidden w-[24rem] shrink-0 overflow-hidden rounded-lg border border-border md:block">
              <ChatSurface />
            </aside>
          )}
        </main>
      </div>

      {/* Full navigation, off-canvas below md (topbar menu / rail button). */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>al-yo-bo</SheetTitle>
            <SheetDescription>Categories and tags</SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <SidebarNav {...sidebarProps} onNavigate={() => setNavOpen(false)} />
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
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddBookmarkDialog
        open={addOpen}
        categories={categories}
        onOpenChange={setAddOpen}
        onCreated={reload}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={reload}
      />
      <VocabDialog
        open={vocabOpen}
        categories={categories}
        sections={sections}
        onOpenChange={setVocabOpen}
        onChanged={reload}
      />
      <BookmarkDetailDialog
        bookmark={selected}
        categories={categories}
        tags={tags}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
        onChanged={reload}
        onDeleted={() => {
          setSelected(null);
          reload();
        }}
      />
    </div>
  );
}
