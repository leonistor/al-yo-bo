import type { DevProfile, Profile } from '@al-yo-bo/shared';
import { ArrowLeftIcon, CheckIcon, Loader2Icon, SparklesIcon, UserIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  createBulkVocabulary,
  type SuggestedCategory,
  type SuggestedTag,
  suggestVocabulary,
  updateProfile,
} from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

type SetupStep = 'identity' | 'developer-profile' | 'suggestions' | 'confirm';

const FOCUS_OPTIONS = [
  'Backend',
  'Frontend',
  'Fullstack',
  'Mobile',
  'DevOps-Infra',
  'Data-ML',
] as const;

const LANGUAGE_OPTIONS = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'Kotlin',
  'C#',
  'C/C++',
  'Ruby',
  'PHP',
  'Swift',
  'SQL',
] as const;

const FRAMEWORK_OPTIONS = [
  'React',
  'Next.js',
  'Vue',
  'Svelte',
  'Angular',
  'Node (Hono/Express)',
  'Django',
  'FastAPI',
  'Rails',
  'Laravel',
  'Spring',
  '.NET',
  'Flutter',
  'React Native',
  'Electron/Tauri',
] as const;

const TOOL_OPTIONS = [
  'Docker',
  'Kubernetes',
  'Postgres',
  'SQLite',
  'Redis',
  'AWS',
  'GCP',
  'Azure',
  'Cloudflare',
  'Terraform',
  'GitHub Actions',
  'Bun',
  'pnpm',
] as const;

const EXPERIENCE_OPTIONS = ['<2y', '2-5y', '5-10y', '10+y'] as const;

interface ToggleChipProps {
  value: string;
  selected: boolean;
  onSelect: (value: string) => void;
}

/** One selectable pill in the questionnaire; selected uses the primary surface. */
function ToggleChip({ value, selected, onSelect }: ToggleChipProps) {
  const handleClick = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <button
      type="button"
      onClick={handleClick}
      data-selected={selected}
      className={cn(
        'rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-accent/50',
      )}
    >
      {value}
    </button>
  );
}

interface MultiChipGroupProps {
  options: readonly string[];
  values: string[];
  onChange: (values: string[]) => void;
}

/** Preset chips plus a free-text add row; preserves custom values the user typed. */
function MultiChipGroup({ options, values, onChange }: MultiChipGroupProps) {
  const [draft, setDraft] = useState('');

  const toggle = useCallback(
    (value: string) => {
      onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
    },
    [onChange, values],
  );

  const addCustom = useCallback(() => {
    const value = draft.trim();
    if (value === '' || values.includes(value)) {
      return;
    }
    onChange([...values, value]);
    setDraft('');
  }, [draft, onChange, values]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCustom();
      }
    },
    [addCustom],
  );

  const handleDraftChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <ToggleChip
            key={option}
            value={option}
            selected={values.includes(option)}
            onSelect={toggle}
          />
        ))}
        {values
          .filter((value) => !options.includes(value))
          .map((value) => (
            <ToggleChip key={value} value={value} selected onSelect={toggle} />
          ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          placeholder="Add custom…"
          size="sm"
          className="max-w-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={addCustom}>
          Add
        </Button>
      </div>
    </div>
  );
}

interface OneOfChipGroupProps {
  options: readonly string[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

/** Single-select chip row; clicking the active choice clears it. */
function OneOfChipGroup({ options, value, onChange }: OneOfChipGroupProps) {
  const handleSelect = useCallback(
    (selectedValue: string) => {
      onChange(value === selectedValue ? undefined : selectedValue);
    },
    [onChange, value],
  );

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <ToggleChip
          key={option}
          value={option}
          selected={value === option}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}

interface SuggestionsState {
  available: boolean;
  tags: SuggestedTag[];
  categories: SuggestedCategory[];
  checkedTags: Set<string>;
  checkedCategories: Set<string>;
}

function tagKey(tag: SuggestedTag): string {
  return tag.name;
}

function categoryKey(category: SuggestedCategory): string {
  return category.path.join('\0');
}

interface TagSuggestionRowProps {
  tag: SuggestedTag;
  checked: boolean;
  onToggle: (tag: SuggestedTag) => void;
}

function TagSuggestionRow({ tag, checked, onToggle }: TagSuggestionRowProps) {
  const handleChange = useCallback(() => {
    onToggle(tag);
  }, [onToggle, tag]);

  return (
    <Label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card p-2 font-normal hover:bg-accent/30">
      <Checkbox checked={checked} onCheckedChange={handleChange} className="mt-0.5" />
      <div className="flex flex-col">
        <span className="text-sm">{tag.name}</span>
        {tag.description && (
          <span className="text-xs text-muted-foreground">{tag.description}</span>
        )}
      </div>
    </Label>
  );
}

interface CategorySuggestionRowProps {
  category: SuggestedCategory;
  checked: boolean;
  onToggle: (category: SuggestedCategory) => void;
}

function CategorySuggestionRow({ category, checked, onToggle }: CategorySuggestionRowProps) {
  const handleChange = useCallback(() => {
    onToggle(category);
  }, [onToggle, category]);

  return (
    <Label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card p-2 font-normal hover:bg-accent/30">
      <Checkbox checked={checked} onCheckedChange={handleChange} className="mt-0.5" />
      <div className="flex flex-col">
        <span className="text-sm">{category.path.join(' / ')}</span>
        {category.description && (
          <span className="text-xs text-muted-foreground">{category.description}</span>
        )}
      </div>
    </Label>
  );
}

interface SetupPageProps {
  profile: Profile;
}

/**
 * First-run setup wizard (DESIGN.md §Setup wizard). Gated by
 * `profile.setupCompletedAt == null`; replaces the app shell until finished.
 * Each step persists its own PATCH so a reload never strands the user.
 */
export function SetupPage({ profile }: SetupPageProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<SetupStep>('identity');

  const [name, setName] = useState(profile.name ?? '');
  const [githubUsername, setGithubUsername] = useState(profile.githubUsername ?? '');

  const dev = profile.devProfile;
  const [focus, setFocus] = useState(dev?.focus);
  const [languages, setLanguages] = useState(dev?.languages ?? []);
  const [frameworks, setFrameworks] = useState(dev?.frameworks ?? []);
  const [tools, setTools] = useState(dev?.tools ?? []);
  const [experience, setExperience] = useState(dev?.experience);
  const [notes, setNotes] = useState(dev?.notes ?? '');

  const handleNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  const handleGithubUsernameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setGithubUsername(event.target.value);
  }, []);

  const handleNotesChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(event.target.value);
  }, []);

  const [suggestions, setSuggestions] = useState<SuggestionsState | null>(null);
  const [suggestionsProfileKey, setSuggestionsProfileKey] = useState<string | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const [completing, setCompleting] = useState(false);

  const devProfile: DevProfile = useMemo(
    () => ({
      source: 'questionnaire',
      focus,
      languages,
      frameworks,
      tools,
      experience,
      notes: notes.trim() === '' ? undefined : notes.trim(),
    }),
    [focus, languages, frameworks, tools, experience, notes],
  );

  const devProfileKey = useMemo(() => JSON.stringify(devProfile), [devProfile]);

  const invalidateProfile = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
  }, [queryClient]);

  const finishSetup = useCallback(async () => {
    setCompleting(true);
    try {
      await updateProfile({ setupCompletedAt: Date.now() });
      invalidateProfile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to finish setup');
      setCompleting(false);
    }
  }, [invalidateProfile]);

  const saveIdentity = useCallback(async () => {
    try {
      await updateProfile({
        name: name.trim() === '' ? null : name.trim(),
        githubUsername: githubUsername.trim() === '' ? null : githubUsername.trim().replace(/^@/, ''),
      });
      invalidateProfile();
      setStep('developer-profile');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save identity');
    }
  }, [name, githubUsername, invalidateProfile]);

  const saveDevProfile = useCallback(async () => {
    try {
      await updateProfile({ devProfile });
      invalidateProfile();
      setStep('suggestions');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save developer profile');
    }
  }, [devProfile, invalidateProfile]);

  // Fetch suggestions when entering the suggestions step, but preserve the
  // current selection if the dev profile hasn't changed since the last fetch.
  useEffect(() => {
    if (step !== 'suggestions') {
      return;
    }
    if (suggestions !== null && suggestionsProfileKey === devProfileKey) {
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    suggestVocabulary(devProfile)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSuggestions({
          available: result.available,
          tags: result.tags,
          categories: result.categories,
          checkedTags: new Set(result.tags.map(tagKey)),
          checkedCategories: new Set(result.categories.map(categoryKey)),
        });
        setSuggestionsProfileKey(devProfileKey);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        toast.error(error instanceof Error ? error.message : 'Failed to load suggestions');
        setSuggestions({
          available: false,
          tags: [],
          categories: [],
          checkedTags: new Set(),
          checkedCategories: new Set(),
        });
        setSuggestionsProfileKey(devProfileKey);
      })
      .finally(() => {
        if (!cancelled) {
          setSuggestionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [step, devProfile, devProfileKey, suggestions, suggestionsProfileKey]);

  const toggleTag = useCallback((tag: SuggestedTag) => {
    setSuggestions((current) => {
      if (!current) {
        return current;
      }
      const key = tagKey(tag);
      const next = new Set(current.checkedTags);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...current, checkedTags: next };
    });
  }, []);

  const toggleCategory = useCallback((category: SuggestedCategory) => {
    setSuggestions((current) => {
      if (!current) {
        return current;
      }
      const key = categoryKey(category);
      const next = new Set(current.checkedCategories);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...current, checkedCategories: next };
    });
  }, []);

  const selectedTags = useMemo(
    () => suggestions?.tags.filter((tag) => suggestions.checkedTags.has(tagKey(tag))) ?? [],
    [suggestions],
  );

  const selectedCategories = useMemo(
    () =>
      suggestions?.categories.filter((category) =>
        suggestions.checkedCategories.has(categoryKey(category)),
      ) ?? [],
    [suggestions],
  );

  const confirmVocabulary = useCallback(async () => {
    setCompleting(true);
    try {
      if (selectedTags.length > 0 || selectedCategories.length > 0) {
        await createBulkVocabulary({ tags: selectedTags, categories: selectedCategories });
      }
      await updateProfile({ setupCompletedAt: Date.now() });
      invalidateProfile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create vocabulary');
      setCompleting(false);
    }
  }, [selectedTags, selectedCategories, invalidateProfile]);

  const goBack = useCallback(() => {
    if (step === 'developer-profile') {
      setStep('identity');
    } else if (step === 'suggestions') {
      setStep('developer-profile');
    } else if (step === 'confirm') {
      setStep('suggestions');
    }
  }, [step]);

  const goToConfirm = useCallback(() => {
    setStep('confirm');
  }, []);

  const canSkip = !completing;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-none">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Welcome to al-yo-bo</h1>
            <p className="text-xs text-muted-foreground">
              Step{' '}
              {step === 'identity'
                ? '1'
                : step === 'developer-profile'
                  ? '2'
                  : step === 'suggestions'
                    ? '3'
                    : '4'}{' '}
              of 4
            </p>
          </div>
        </div>

        {step === 'identity' && (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={name} onChange={handleNameChange} placeholder="Your name" />
            </Field>
            <Field>
              <FieldLabel>GitHub username</FieldLabel>
              <Input
                value={githubUsername}
                onChange={handleGithubUsernameChange}
                placeholder="@username"
              />
            </Field>
          </div>
        )}

        {step === 'developer-profile' && (
          <ScrollArea className="max-h-[60vh]">
            <div className="flex flex-col gap-4 pr-2">
              <Field>
                <FieldLabel>Focus</FieldLabel>
                <OneOfChipGroup options={FOCUS_OPTIONS} value={focus} onChange={setFocus} />
              </Field>

              <Field>
                <FieldLabel>Languages</FieldLabel>
                <MultiChipGroup options={LANGUAGE_OPTIONS} values={languages} onChange={setLanguages} />
              </Field>

              <Field>
                <FieldLabel>Frameworks</FieldLabel>
                <MultiChipGroup
                  options={FRAMEWORK_OPTIONS}
                  values={frameworks}
                  onChange={setFrameworks}
                />
              </Field>

              <Field>
                <FieldLabel>Tools</FieldLabel>
                <MultiChipGroup options={TOOL_OPTIONS} values={tools} onChange={setTools} />
              </Field>

              <Field>
                <FieldLabel>Experience</FieldLabel>
                <OneOfChipGroup
                  options={EXPERIENCE_OPTIONS}
                  value={experience}
                  onChange={setExperience}
                />
              </Field>

              <Field>
                <FieldLabel>Anything else?</FieldLabel>
                <Textarea
                  value={notes}
                  onChange={handleNotesChange}
                  placeholder="Notes, preferences, or context for the vocabulary suggestions."
                  className="min-h-[5rem] resize-none"
                />
              </Field>
            </div>
          </ScrollArea>
        )}

        {step === 'suggestions' && (
          <div className="flex flex-col gap-4">
            {suggestionsLoading || !suggestions ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading suggestions…
              </div>
            ) : !suggestions.available ? (
              <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
                No LLM configured — you can skip and your vocabulary will come from your first
                import.
              </div>
            ) : (
              <>
                {suggestions.tags.length > 0 && (
                  <Field>
                    <FieldLabel>
                      Tags{' '}
                      <Badge variant="secondary" className="ml-1">
                        {suggestions.tags.length}
                      </Badge>
                    </FieldLabel>
                    <div className="flex flex-col gap-2">
                      {suggestions.tags.map((tag) => (
                        <TagSuggestionRow
                          key={tagKey(tag)}
                          tag={tag}
                          checked={suggestions.checkedTags.has(tagKey(tag))}
                          onToggle={toggleTag}
                        />
                      ))}
                    </div>
                  </Field>
                )}

                {suggestions.categories.length > 0 && (
                  <Field>
                    <FieldLabel>
                      Categories{' '}
                      <Badge variant="secondary" className="ml-1">
                        {suggestions.categories.length}
                      </Badge>
                    </FieldLabel>
                    <div className="flex flex-col gap-2">
                      {suggestions.categories.map((category) => (
                        <CategorySuggestionRow
                          key={categoryKey(category)}
                          category={category}
                          checked={suggestions.checkedCategories.has(categoryKey(category))}
                          onToggle={toggleCategory}
                        />
                      ))}
                    </div>
                  </Field>
                )}

                {suggestions.tags.length === 0 && suggestions.categories.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No new vocabulary suggested. Skip to continue.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Ready to create your starter vocabulary.
            </p>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <CheckIcon className="size-4 text-primary" />
                <span className="text-sm font-medium">{selectedTags.length} tags selected</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckIcon className="size-4 text-primary" />
                <span className="text-sm font-medium">
                  {selectedCategories.length} categories selected
                </span>
              </div>
            </div>

            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedTags.map((tag) => (
                  <Badge key={tagKey(tag)} variant="secondary">
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}

            {selectedCategories.length > 0 && (
              <div className="flex flex-col gap-1">
                {selectedCategories.map((category) => (
                  <span key={categoryKey(category)} className="text-sm text-muted-foreground">
                    {category.path.join(' / ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            disabled={step === 'identity' || completing}
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={finishSetup}
              disabled={!canSkip}
              className="text-muted-foreground"
            >
              Skip setup
            </Button>

            {step === 'identity' && (
              <Button size="sm" onClick={saveIdentity}>
                Continue
              </Button>
            )}

            {step === 'developer-profile' && (
              <Button size="sm" onClick={saveDevProfile}>
                Continue
              </Button>
            )}

            {step === 'suggestions' && (
              <Button
                size="sm"
                onClick={goToConfirm}
                disabled={suggestionsLoading || completing}
              >
                {suggestionsLoading ? (
                  <Spinner className="size-4" />
                ) : (
                  <SparklesIcon className="size-4" />
                )}
                Continue
              </Button>
            )}

            {step === 'confirm' && (
              <Button size="sm" onClick={confirmVocabulary} disabled={completing}>
                {completing ? <Spinner className="size-4" /> : <CheckIcon className="size-4" />}
                Confirm
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
