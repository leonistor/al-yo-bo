# Design — Dataset-scoped vocabulary with review-before-activation

> Date: 2026-10-01 · Status: superseded (2026-10-01) · Related docs: [MODEL.md](../MODEL.md), [ARCHITECTURE.md](../ARCHITECTURE.md)

**Outcome (2026-10-01):** implemented as migration `0003_dataset_vocabulary.sql` (datasets table,
dataset-scoped vocabulary/bookmarks, sections + flat categories, propose→review→activate), then the
review-before-activation lifecycle (§3, §5) was **deliberately reversed** the same day by decision #4
of the [import-simplification plan](./2026-10-01-import-simplification-implementation.md):
migration `0004_simplify_vocabulary.sql` auto-creates vocabulary as `active` on import, drops
`proposed`/`rejected` statuses and `merged_into_id`, and the classifier never auto-creates tags.
Dataset scoping (§1, §4, §7) and the sections schema (§2) remain in force. Category-explosion
mitigation is manual (VocabDialog rename/delete), not review-gated.

## Problem

Two symptoms from Leo's real five-file import (`leo` dataset):

1. **Category explosion.** Every `## Heading` (H2) in a collection file becomes a category on
   demand at ingest (`packages/importer/src/ingest.ts`). Five files produce **40 categories** with
   near-duplicates ("vitrina" / "vitrina / branding", "next" / "next.js") and one-off headings
   ("collect 16 Nov 2025", "wordnotexist syllabes", "React +  Tailwind + Framer Motion").
2. **Cross-dataset tag leak.** The `tags` table is global. Seeding `leo` after `grimoire` without
   `SEED_RESET=1` leaves grimoire's ~50 tags active. The classifier candidate set for a bookmark
   **without a category is all active tags** (ARCHITECTURE §7 Stage 0), so grimoire vocabulary gets
   auto-assigned to leo bookmarks. There is no dataset boundary and no vocabulary gate at import.

The user proposes two fixes to review:

1. **Establish a vocabulary (categories + tags) when a new dataset is inited and when a batch import
   happens** — automatic proposal, human review.
2. **Two-level categories** — sections with flat categories inside each.

## Findings

### Branch: vocabulary-lifecycle

Vocabulary establishment runs at **both dataset init and every batch import**:

- **Dataset init** (empty dataset): the system auto-proposes the initial vocabulary (categories +
  tags) for the new dataset.
- **Batch import**: any H2 heading or tag name not already in the dataset's established vocabulary is
  **never auto-created** — it is proposed for review instead. This replaces today's
  create-category-on-demand behavior with a **propose → review → activate** lifecycle.

### Branch: dataset-scoping

**Dataset is a real runtime scoping boundary**, not just a seed-time concept. Vocabulary (categories +
tags) lives under dataset scope; each dataset owns its bookmarks **and** its complete vocabulary.
Existing unscoped global tags (grimoire's 50) are migrated into dataset scope, attributed by import
provenance (which dataset's import created/used them). This makes the grimoire→leo leak structurally
impossible: leo bookmarks never see grimoire's tags as candidates.

### Branch: category-hierarchy

*(Probe response failed to parse; recommendation synthesized from codebase analysis + other branch
findings.)*

The user's proposal ("sections + flat categories in each") is best served by a **dedicated `sections`
table** with `categories.section_id`, rather than self-referencing `categories.parent_id`:

- Matches the user's mental model exactly: sections are the top level, categories are flat within.
- Keeps categories flat (preserves MODEL.md's "organizing axis, not a hierarchy" within a section);
  no recursive tree semantics leak into queries, search filters, or UI navigation.
- H2 → section, H3 → category is a natural mapping, and the LLM-assisted proposal pass can regroup
  near-duplicate H2s ("AI" / "AI design" / "AI dev" / "AI scrape" / "AI skills") into one section
  with flat categories, collapsing ~40 categories to a small set.

### Branch: classification-scope

Classification is scoped **per-dataset**: the candidate set for a bookmark is computed from the
**active** vocabulary belonging to that bookmark's dataset only — not per-section, not global.
Proposed (not-yet-approved) vocabulary is never auto-assigned, so rejected or renamed vocabulary
never accumulates immutable `classification_runs` / `classification_results` evidence. This extends
the existing "only `active` tags are auto-assigned" invariant with dataset scoping and preserves
evidence immutability under the review-before-activation lifecycle.

### Branch: review-ux

Review happens on a **dedicated per-batch review page** with bulk actions: accept, reject, rename,
and merge near-duplicates. Rejected or renamed vocabulary is recorded (a status field on the
vocabulary record) so it **never resurfaces** in future imports. Merging works both ways: the system
auto-suggests likely merges (e.g. vitrina / vitrina / branding, AI / AI design / AI dev) and the user
can merge manually.

## Recommendation

### 1. Dataset becomes a runtime scope

New `datasets` table; `bookmarks`, `categories`, `tags` gain a `dataset_id` (NOT NULL for new rows;
migration assigns existing rows to a default dataset — see §7).

```sql
CREATE TABLE datasets (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE UNIQUE INDEX datasets_name_unique ON datasets(name);
```

- `bookmarks.dataset_id` NOT NULL → `datasets(id)`. A bookmark belongs to exactly one dataset.
- `categories.dataset_id` NOT NULL, `sections.dataset_id` NOT NULL.
- `tags.dataset_id` NOT NULL. Tag uniqueness becomes dataset-scoped:
  `UNIQUE(dataset_id, category_id, name)` where scoped, `UNIQUE(dataset_id, name)` where unscoped.
- `metadata.import` keeps the **raw source names** (`file`, `section` H2, `subsection` H3) for
  provenance; the FK columns hold the resolved vocabulary.

### 2. Two-level organization: `sections` + flat `categories`

```sql
CREATE TABLE sections (
  id          BLOB PRIMARY KEY NOT NULL CHECK (typeof(id) = 'blob' AND length(id) = 16),
  dataset_id  BLOB NOT NULL REFERENCES datasets(id) ON DELETE CASCADE
                  CHECK (typeof(dataset_id) = 'blob' AND length(dataset_id) = 16),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE UNIQUE INDEX sections_dataset_name_unique ON sections(dataset_id, name);
```

- `categories.section_id` nullable FK → `sections(id)` (ON DELETE SET NULL). A category may also
  exist at dataset level without a section.
- Category names unique per dataset (`UNIQUE(dataset_id, name)`).
- H2 → section, H3 → category. When a file has H2-only structure, the proposal pass groups related
  H2s into a section and proposes the rest as dataset-level categories (LLM-assisted when available,
  deterministic fallback: H2 → section, H3 → category, exact-name matching).

### 3. Vocabulary lifecycle: propose → review → activate

- **Categories** gain `status` ('active' | 'proposed' | 'rejected'); **tags** gain 'rejected' in the
  existing enum ('active' | 'proposed' | 'deprecated' | 'rejected'). Both gain an optional
  `merged_into_id` (self-FK) recording the resolution target of a rejected/renamed entry.
- **Import becomes two-phase.** Parse → vocabulary resolution pass → commit:
  1. For each raw heading/tag name, match against the dataset's vocabulary:
     - active entry with the same name → reuse;
     - rejected entry with the same name → follow `merged_into_id` (or skip if rejected outright);
     - no match → create a `proposed` entry.
  2. If any proposals exist, the import is **staged** and a review batch is surfaced.
  3. On review resolution (accept/rename/merge/reject), the import commits: bookmarks created and
     assigned to the resolved categories/tags.
  4. If nothing is new (all names resolve), the import commits directly — fully automatic.
- **Dataset init** runs the same flow with the whole dataset's vocabulary as the first batch.
- **Classifier-proposed tags** inherit the bookmark's dataset and stay `proposed` until approved.

### 4. Classification scope: per-dataset

Rewrite ARCHITECTURE §7 Stage 0 candidate set:

- Candidates = `active` tags where `tags.dataset_id = bookmark.dataset_id`.
- Optional refinement (question-count bound): restrict to the bookmark's category scope — tags in the
  bookmark's category plus unscoped tags — within the dataset. The dataset gate is mandatory; the
  category filter is an optimization.
- Rejected/renamed vocabulary never appears in candidates, so no immutable evidence is ever created
  for it.

### 5. Review UX

New review page (per-batch, dataset-scoped): list all proposed categories/tags with the bookmark
count behind each, bulk accept/reject, rename, and merge (auto-suggested near-duplicates + manual).
Rejected names are recorded with status='rejected' (+ `merged_into_id` when merged) so re-imports
resolve them silently instead of re-proposing.

### 6. Importer changes

- `ingestBookmarks` no longer creates categories on demand; it resolves names against the dataset
  vocabulary and returns a `proposed` set when new vocabulary appears.
- `parseCollection` keeps parsing raw H2/H3/frontmatter names unchanged; the resolution pass lives in
  the importer/core boundary (transport-neutral, testable).
- Seed fixtures (`leo.seed.json`, `grimoire.seed.json`) gain a `dataset` field; `seedFromFile` scopes
  everything to it. `extract-leo-seed.ts` / `extract-grimoire-seed.ts` updated accordingly.

### 7. Migration

Pre-v1, single-user: create a default dataset (named from `SEED_DATASET`, else `default`), assign all
existing bookmarks/categories/tags to it, set categories.status='active' and tags.status as-is.
Classifier-proposed tags already carry provenance via `classification_runs` → bookmark → dataset.

## Docs to update

- **MODEL.md** — new `datasets`, `sections` tables; `dataset_id` on bookmarks/categories/tags;
  category/tag status enums; uniqueness invariants; deletion semantics for datasets (cascade to
  bookmarks/vocabulary) and sections (SET NULL on categories).
- **ARCHITECTURE.md** — §7 Stage 0 candidate set (per-dataset), Stage 1 import flow (two-phase,
  propose → review → activate), new review page in Stage 5, and the vocabulary-establishment step.
- **DESIGN.md** — review page component guidance (bulk actions, merge suggestions).
- **AGENTS.md** — nothing structural; note the importer no longer creates categories on demand.

## Open questions

- Should a bookmark be movable between datasets, and what happens to its classifier evidence then?
- Should sections be user-creatable outside imports (manual vocabulary management), or import-only?
- LLM-assisted proposal: which model/provider (Ollaya decision model vs. a generative call), and is
  it optional-with-fallback as the classifier is?