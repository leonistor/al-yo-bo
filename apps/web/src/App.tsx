import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
  Aggregates,
  BookmarkSort,
  BookmarkWithTags,
  Category,
  ReviewCandidate,
  SearchMode,
  SearchResponse,
  Tag,
} from '@al-yo-bo/shared';

import { AddBookmarkDialog } from '@/components/AddBookmarkDialog';
import { BookmarkDetailDialog } from '@/components/BookmarkDetailDialog';
import { BookmarkList } from '@/components/BookmarkList';
import { ImportDialog } from '@/components/ImportDialog';
import { ResultsToolbar } from '@/components/ResultsToolbar';
import { ReviewQueue } from '@/components/ReviewQueue';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/ui/button';
import { VocabDialog } from '@/components/VocabDialog';
import {
  acceptCandidate,
  fetchAggregates,
  fetchBookmarks,
  fetchCategories,
  fetchProposedTags,
  fetchReviewCandidates,
  fetchTags,
  setTagStatus,
} from '@/lib/client';
import { useLayout } from '@/lib/useLayout';
import { useTheme } from '@/lib/useTheme';

const PAGE_SIZE = 20;
type View = 'library' | 'review';

export function App() {
  const [view, setView] = useState<View>('library');
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('keyword');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [sort, setSort] = useState<BookmarkSort>('created_at');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const [layout, setLayout] = useLayout();
  const [theme, setTheme] = useTheme();

  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [bookmarks, setBookmarks] = useState<SearchResponse | null>(null);
  const [proposed, setProposed] = useState<Tag[]>([]);
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BookmarkWithTags | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [vocabOpen, setVocabOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);

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
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      const [aggregateData, categoryData, tagData, proposedData, candidateData] = await Promise.all([
        fetchAggregates(),
        fetchCategories(),
        fetchTags(),
        fetchProposedTags(),
        fetchReviewCandidates(),
      ]);
      setAggregates(aggregateData);
      setCategories(categoryData);
      setTags(tagData);
      setProposed(proposedData);
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
  }, [searchQuery, mode, categoryId, tagId, sort, direction, page]);

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

  async function approveTag(id: string) {
    try {
      await setTagStatus(id, 'active');
      toast.success('Tag approved');
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve tag');
    }
  }

  async function rejectTag(id: string) {
    try {
      await setTagStatus(id, 'deprecated');
      toast.success('Tag rejected');
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reject tag');
    }
  }

  async function accept(candidate: ReviewCandidate) {
    try {
      await acceptCandidate(candidate.bookmarkId, candidate.tagId);
      toast.success('Candidate accepted');
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to accept candidate');
    }
  }

  const reviewCount = proposed.length + candidates.length;
  const total = bookmarks?.total ?? 0;

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        aggregates={aggregates}
        view={view}
        selectedCategoryId={categoryId}
        selectedTagId={tagId}
        reviewCount={reviewCount}
        onSelectView={setView}
        onSelectCategory={(id) => {
          setCategoryId(id);
          setPage(0);
        }}
        onSelectTag={(id) => {
          setTagId(id);
          setPage(0);
        }}
        onManageVocabulary={() => setVocabOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          query={query}
          mode={mode}
          theme={theme}
          searchRef={searchRef}
          onQueryChange={setQuery}
          onModeChange={(next) => {
            setMode(next);
            setPage(0);
          }}
          onThemeChange={setTheme}
          onAdd={() => setAddOpen(true)}
          onImport={() => setImportOpen(true)}
        />

        <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {view === 'library' ? (
            <>
              <ResultsToolbar
                total={total}
                loading={loading}
                sort={sort}
                direction={direction}
                layout={layout}
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

              <div className="min-h-0 flex-1 overflow-auto">
                <BookmarkList
                  items={bookmarks?.items ?? []}
                  loading={loading}
                  layout={layout}
                  onOpen={setSelected}
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
              <ReviewQueue
                proposed={proposed}
                candidates={candidates}
                loading={loading}
                onApprove={approveTag}
                onReject={rejectTag}
                onAccept={accept}
              />
            </div>
          )}
        </main>
      </div>

      <AddBookmarkDialog
        open={addOpen}
        categories={categories}
        onOpenChange={setAddOpen}
        onCreated={reload}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={reload} />
      <VocabDialog
        open={vocabOpen}
        categories={categories}
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
