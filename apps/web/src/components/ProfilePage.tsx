import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Profile, SearchMode } from '@al-yo-bo/shared';
import type { LucideIcon } from 'lucide-react';
import {
  BinaryIcon,
  BrainCircuitIcon,
  CameraIcon,
  CombineIcon,
  DatabaseIcon,
  FileTextIcon,
  Grid3x3Icon,
  ImageIcon,
  LayoutGridIcon,
  ListIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  Rows3Icon,
  SparklesIcon,
  SunIcon,
  TypeIcon,
  UserIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { editableInputClass, InlineEditInput } from '@/components/EditableRow';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useInlineEdit } from '@/hooks/useInlineEdit';
import {
  deleteAvatar,
  fetchActiveDataset,
  fetchHealth,
  updateProfile,
  uploadAvatar,
  type HealthReport,
} from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import type { Layout } from '@/lib/useLayout';
import type { Theme } from '@/lib/useTheme';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

interface ProfilePageProps {
  profile: Profile | null;
  theme: Theme;
  layout: Layout;
  defaultSearchMode: SearchMode;
  onThemeChange: (theme: Theme) => void;
  onLayoutChange: (layout: Layout) => void;
  onDefaultSearchModeChange: (mode: SearchMode) => void;
}

interface InlineFieldProps {
  label: string;
  value: string | null;
  placeholder: string;
  error?: string;
  onCommit: (value: string) => Promise<void>;
  onClearError?: () => void;
}

/**
 * Field label + inline-editable value. Enter commits, Escape cancels, and focus
 * returns to the display button after commit or cancel so keyboard users don't
 * lose their place.
 */
function InlineField({ label, value, placeholder, error, onCommit, onClearError }: InlineFieldProps) {
  const displayRef = useRef<HTMLButtonElement>(null);
  const shouldFocusRef = useRef(false);

  const wrappedCommit = useCallback(
    async (draft: string) => {
      shouldFocusRef.current = true;
      await onCommit(draft);
    },
    [onCommit],
  );

  const inline = useInlineEdit(value ?? '', wrappedCommit);
  const { setDraft } = inline;

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [setDraft],
  );

  const handleStart = useCallback(() => {
    shouldFocusRef.current = true;
    onClearError?.();
    inline.startEdit();
  }, [inline, onClearError]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Return focus to the display button and clear any commit error when the
      // user cancels with Escape.
      if (event.key === 'Escape') {
        shouldFocusRef.current = true;
        onClearError?.();
      }
      inline.handleKeyDown(event);
    },
    [inline, onClearError],
  );

  useEffect(() => {
    if (!inline.editing && shouldFocusRef.current) {
      displayRef.current?.focus();
      shouldFocusRef.current = false;
    }
  }, [inline.editing]);

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        {inline.editing ? (
          <InlineEditInput
            editing={inline.editing}
            value={inline.draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={cn(editableInputClass, 'w-full')}
          />
        ) : (
          <button
            ref={displayRef}
            type="button"
            onClick={handleStart}
            className="min-h-7 w-full cursor-pointer text-left text-sm focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">{placeholder}</span>}
          </button>
        )}
        {inline.pending && <Spinner className="absolute right-2 top-1.5 size-4" />}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </Field>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
];

const LAYOUT_OPTIONS: { value: Layout; label: string; icon: LucideIcon }[] = [
  { value: 'list', label: 'List', icon: ListIcon },
  { value: 'compact', label: 'Compact', icon: Rows3Icon },
  { value: 'grid', label: 'Grid', icon: LayoutGridIcon },
  { value: 'dense', label: 'Dense', icon: Grid3x3Icon },
];

const SEARCH_MODE_OPTIONS: { value: SearchMode; label: string; icon: LucideIcon }[] = [
  { value: 'keyword', label: 'Keyword', icon: TypeIcon },
  { value: 'semantic', label: 'Semantic', icon: SparklesIcon },
  { value: 'hybrid', label: 'Hybrid', icon: CombineIcon },
];

interface HealthStatusBadgeProps {
  available: boolean;
  degraded?: boolean;
}

function HealthStatusBadge({ available, degraded }: HealthStatusBadgeProps) {
  if (available) {
    return <Badge variant="default">Available</Badge>;
  }
  if (degraded) {
    return <Badge variant="destructive">Degraded</Badge>;
  }
  return <Badge variant="secondary">Unavailable</Badge>;
}

interface HealthRowConfig {
  id: string;
  name: string;
  icon: LucideIcon;
  status: (health: HealthReport) => { available: boolean; degraded: boolean };
  meta: (health: HealthReport) => string | null;
  pending?: (health: HealthReport) => number;
}

const HEALTH_ROWS: HealthRowConfig[] = [
  {
    id: 'classifier',
    name: 'Classifier',
    icon: BrainCircuitIcon,
    status: (h) => ({
      available: h.classifier.available && h.classifier.reachable,
      degraded: h.classifier.available && !h.classifier.reachable,
    }),
    meta: (h) => h.classifier.model,
    pending: (h) => h.enrichment.jobsPending,
  },
  {
    id: 'embeddings',
    name: 'Embeddings',
    icon: BinaryIcon,
    status: (h) => ({ available: h.embeddings.enabled, degraded: false }),
    meta: (h) => h.embeddings.model,
  },
  {
    id: 'vectors',
    name: 'Vectors',
    icon: DatabaseIcon,
    status: () => ({ available: true, degraded: false }),
    meta: (h) => `${h.vector.backend} · ${h.vector.indexed} indexed`,
  },
  {
    id: 'chat',
    name: 'Chat',
    icon: MessageSquareIcon,
    status: (h) => ({ available: h.chat.available, degraded: false }),
    meta: (h) => h.chat.model,
  },
  {
    id: 'extract',
    name: 'Extract',
    icon: FileTextIcon,
    status: (h) => ({ available: h.extract.available, degraded: false }),
    meta: (h) => h.extract.provider,
  },
  {
    id: 'screenshot',
    name: 'Screenshot',
    icon: ImageIcon,
    status: (h) => ({ available: h.screenshot.available, degraded: false }),
    meta: () => null,
  },
];

function HealthRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-1.5" aria-hidden>
      <Skeleton className="size-4 rounded-sm" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="ml-auto h-5 w-16 rounded-full" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

function HealthRow({
  row,
  health,
  unavailable,
}: {
  row: HealthRowConfig;
  health: HealthReport | null;
  unavailable: boolean;
}) {
  const Icon = row.icon;
  const status = unavailable || !health ? { available: false, degraded: false } : row.status(health);
  const meta = unavailable || !health ? null : row.meta(health);
  const pending = unavailable || !health ? 0 : row.pending?.(health) ?? 0;

  return (
    <div className="flex min-w-0 items-center gap-3 py-1.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 shrink-0 text-sm">{row.name}</span>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <HealthStatusBadge available={status.available} degraded={status.degraded} />
        {meta && <span className="truncate font-mono text-xs text-muted-foreground">{meta}</span>}
        {pending > 0 && row.pending && (
          <span className="text-xs text-muted-foreground tabular-nums">{pending} pending</span>
        )}
      </div>
    </div>
  );
}

function SystemStatusCard() {
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
  });
  const unavailable = error !== null || data === null;

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">System status</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh system status"
          disabled={isFetching}
          onClick={handleRefresh}
        >
          <RefreshCwIcon className={cn('size-4', isFetching && 'animate-spin')} />
        </Button>
      </div>
      <div className="mt-3 flex flex-col">
        {isPending ? (
          <>
            <HealthRowSkeleton />
            <HealthRowSkeleton />
            <HealthRowSkeleton />
            <HealthRowSkeleton />
            <HealthRowSkeleton />
            <HealthRowSkeleton />
          </>
        ) : (
          HEALTH_ROWS.map((row) => (
            <HealthRow key={row.id} row={row} health={data ?? null} unavailable={unavailable} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Profile & settings page. Identity fields edit inline per field; preferences
 * use the shared SegmentedControl; diagnostics show subsystem health.
 */
export function ProfilePage({
  profile,
  theme,
  layout,
  defaultSearchMode,
  onThemeChange,
  onLayoutChange,
  onDefaultSearchModeChange,
}: ProfilePageProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; githubUsername?: string }>({});

  const handleOpenRemove = useCallback(() => setRemoveOpen(true), []);

  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      if (file.size > AVATAR_MAX_BYTES) {
        setUploadError('Avatar must be at most 2 MB');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        setUploadError('Avatar must be a JPEG or PNG image');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      setUploadError(null);
      setIsUploading(true);
      try {
        const updated = await uploadAvatar(file);
        queryClient.setQueryData(queryKeys.profile, updated);
        toast.success('Avatar updated');
        // Return focus to the Change button so keyboard users stay in context.
        setTimeout(() => changeButtonRef.current?.focus(), 0);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Failed to upload avatar');
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [queryClient],
  );

  const handleRemove = useCallback(async () => {
    setIsRemoving(true);
    try {
      const updated = await deleteAvatar();
      queryClient.setQueryData(queryKeys.profile, updated);
      toast.success('Avatar removed');
      setRemoveOpen(false);
      setTimeout(() => changeButtonRef.current?.focus(), 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove avatar');
    } finally {
      setIsRemoving(false);
    }
  }, [queryClient]);

  const handleNameCommit = useCallback(
    async (name: string) => {
      try {
        const updated = await updateProfile({ name: name || null });
        queryClient.setQueryData(queryKeys.profile, updated);
        setFieldErrors((prev) => ({ ...prev, name: undefined }));
      } catch (err) {
        setFieldErrors((prev) => ({
          ...prev,
          name: err instanceof Error ? err.message : 'Failed to update name',
        }));
        throw err;
      }
    },
    [queryClient],
  );

  const handleGithubCommit = useCallback(
    async (githubUsername: string) => {
      try {
        const updated = await updateProfile({ githubUsername: githubUsername || null });
        queryClient.setQueryData(queryKeys.profile, updated);
        setFieldErrors((prev) => ({ ...prev, githubUsername: undefined }));
      } catch (err) {
        setFieldErrors((prev) => ({
          ...prev,
          githubUsername: err instanceof Error ? err.message : 'Failed to update GitHub username',
        }));
        throw err;
      }
    },
    [queryClient],
  );

  const clearNameError = useCallback(() => {
    setFieldErrors((prev) => ({ ...prev, name: undefined }));
  }, []);

  const clearGithubError = useCallback(() => {
    setFieldErrors((prev) => ({ ...prev, githubUsername: undefined }));
  }, []);

  const hasAvatar = Boolean(profile?.avatarPath);

  const { data: activeDataset } = useQuery({
    queryKey: queryKeys.activeDataset,
    queryFn: fetchActiveDataset,
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-lg font-semibold tracking-tight">Profile & settings</h1>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <section className="rounded-lg border p-3">
            <h2 className="text-sm font-medium">Identity</h2>

            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                aria-label="Change avatar"
                disabled={isUploading || profile === null}
                onClick={triggerUpload}
                className="relative size-12 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none"
              >
                {profile ? (
                  <ProfileAvatar profile={profile} className="size-12" />
                ) : (
                  <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                    <UserIcon className="size-6 text-muted-foreground" />
                  </span>
                )}
                {isUploading && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
                    <Spinner className="size-5" />
                  </span>
                )}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                tabIndex={-1}
                accept="image/jpeg,image/png"
                onChange={handleFileChange}
                className="sr-only"
              />

              <div className="flex gap-2">
                <Button
                  ref={changeButtonRef}
                  variant="outline"
                  size="sm"
                  disabled={isUploading || profile === null}
                  onClick={triggerUpload}
                >
                  <CameraIcon />
                  Change
                </Button>
                {hasAvatar && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isRemoving}
                    onClick={handleOpenRemove}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            {uploadError && <p className="mt-1.5 text-xs text-destructive">{uploadError}</p>}

            <div className="mt-3 grid gap-2">
            {profile ? (
              <>
                <InlineField
                  label="Name"
                  value={profile.name}
                  placeholder="Add your name"
                  error={fieldErrors.name}
                  onCommit={handleNameCommit}
                  onClearError={clearNameError}
                />
                <InlineField
                  label="GitHub username"
                  value={profile.githubUsername}
                  placeholder="Add your GitHub username"
                  error={fieldErrors.githubUsername}
                  onCommit={handleGithubCommit}
                  onClearError={clearGithubError}
                />
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-7 w-full" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-full" />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-lg border p-3">
          <h2 className="text-sm font-medium">Preferences</h2>
          <div className="mt-3 grid gap-2">
            <SegmentedControl
              label="Theme"
              value={theme}
              onValueChange={onThemeChange}
              options={THEME_OPTIONS}
            />
            <SegmentedControl
              label="Layout"
              value={layout}
              onValueChange={onLayoutChange}
              options={LAYOUT_OPTIONS}
            />
            <SegmentedControl
              label="Default search mode"
              value={defaultSearchMode}
              onValueChange={onDefaultSearchModeChange}
              options={SEARCH_MODE_OPTIONS}
            />
          </div>
        </section>

        <section className="rounded-lg border p-3">
          <h2 className="text-sm font-medium">Dataset</h2>
          <p className="mt-1 text-xs text-muted-foreground">Active dataset</p>
          {activeDataset === undefined ? (
            <Skeleton className="mt-1 h-5 w-28" />
          ) : (
            <p className="mt-0.5 text-sm">{activeDataset ? activeDataset.name : 'Default'}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Switch datasets by seeding; live switching is a planned follow-up.
          </p>
        </section>
        </div>

        <div className="flex flex-col gap-3">
          <SystemStatusCard />
        </div>
      </div>

      <ConfirmDeleteDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove avatar?"
        description="Your avatar will be removed and your initials will be used instead."
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </div>
  );
}
