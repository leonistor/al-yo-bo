# Import simplification — design

> Status: **implemented** — superseded by the
> [implementation plan](./2026-10-01-import-simplification-implementation.md), which shipped in
> full on 2026-10-01. Explored 2026-10-01.
> Related docs: [ARCHITECTURE.md](../ARCHITECTURE.md), [MODEL.md](../MODEL.md), [README.md](../../README.md).

## Problem

The current import workflow is two-phase and approval-gated: a deterministic markdown parser
(`packages/importer/src/parse.ts`) feeds a vocabulary-resolution pass that creates `proposed` rows
for any unmatched name and **stages** the batch in `import_batches` until the user reviews and
commits it. The review queue also carries classifier tag approvals and below-threshold candidates.
This adds friction to the most common action (getting bookmarks in) and couples import to a brittle
file-format contract.

The user wants:

1. **No approval steps in import** — vocabulary management already exists as a separate concern.
2. **A dedicated import page, not a dialog** — with a vertical split: source on the left, extracted
   bookmarks on the right.
3. **The markdown collection-file format demoted** from a hard parser contract to a *suggestion*
   inside an LLM prompt with structured output — import should accept arbitrary text.
4. **Richer bookmark attributes** — a visual (screenshot or og:image) and an AI-summarized
   description.
5. A fresh-start MVP is acceptable.

## Findings (by branch)

### import_ux — page-based import, direct commit

- Vertical split layout: left = source input (paste/upload), right = extracted bookmarks preview.
- Extraction runs **on demand** (user triggers it), not live on every keystroke.
- The extracted preview is **fully editable**: fix titles, URLs, descriptions, tags before commit.
- The final Import button runs a **dedup check** against existing bookmarks; duplicates are
  **merged**, not skipped or rejected. Import commits directly — no staging, no approval step.

### llm_extraction — LLM structured output, markdown as suggestion

- LLM structured-output extraction is the **primary** import path; the markdown format becomes a
  prompt suggestion (headings → sections/categories, bullets → bookmarks, `*` → priority, frontmatter
  → tags).
- When the LLM is unavailable, the import page **falls back to the deterministic markdown parser**
  so import still works offline (graceful degradation, ARCHITECTURE §1.3/§10).

### data_model — direct-commit model

- **`import_batches` table removed** — no staged JSON batches.
- **`proposed` vocabulary lifecycle removed** — the importer auto-creates unmatched
  sections/categories/tags as **active** on commit.
- The **`status` column is dropped** from `sections`, `categories`, and `tags` (vocabulary is always
  active on creation).
- AI-summarized description lives in the bookmark's dedicated `description` field; image references
  (og:image URL / screenshot path) live in `bookmarks.metadata`.

### enrichment — image + summary

- Capture **both** a screenshot (primary visual) and og:image (lightweight alternative) per bookmark.
- Artifacts stored on **local disk** (local-first constraint), referenced from `bookmarks.metadata`.
- Capture failure degrades to a **placeholder image** — never fails the import.
- AI summaries are generated **during import** (synchronous, not a background job), so every imported
  bookmark ships with description + image refs at commit time.

## Recommendation

Adopt all four branch findings as one coherent simplification. The result is a materially smaller
MVP:

### Import flow (new)

```
1. Paste/upload arbitrary text (markdown collection, URL list, anything)  [left pane]
2. "Extract" button → LLM structured output → editable bookmark list       [right pane]
   · LLM down → deterministic markdown parser fallback (same shape)
3. User edits: title, URL, description, tags, priority; remove items
4. "Import" → dedup by URL (merge existing), auto-create missing vocabulary as active,
   write bookmarks + tags, enqueue scrape/embed/screenshot jobs
```

### Data model changes

| Current | New |
| --- | --- |
| `import_batches` (staged JSON) | **removed** |
| `sections.status`, `categories.status`, `tags.status` (proposed/active/deprecated/rejected) | **removed** — vocabulary is created active |
| `merged_into_id` on vocabulary | **removed** (no rejection lifecycle) |
| `bookmarks.description` | AI-summarized description (generated at import) |
| `bookmarks.metadata` | adds `image: { ogImageUrl, screenshotPath }`; keeps import/scrape provenance |
| `classification_runs`/`results`, `bookmark_tags` | **unchanged** (classifier evidence still valuable) |

### What survives in the fresh MVP

- `datasets → sections → categories → bookmarks` organization (keep — cheap, already modeled).
- Tags (dataset-scoped, category-scoped) — the classifier candidate set stays.
- FTS5 keyword search + embeddings + Qdrant/KNN fallback — unchanged.
- Classifier (Ollaya) + immutable evidence — unchanged, but the **review queue UI is reduced** to
  below-threshold candidates only (proposed-vocabulary and proposed-tag sections disappear).
- Enrichment jobs: scrape, embed, classify + new **screenshot** job.

### Open questions to resolve before implementation

1. **Screenshot capture mechanism** — a headless-browser sidecar (Playwright/Chrome) is the obvious
   choice but conflicts with "local single binaries only" unless pinned like Qdrant. Confirm the
   mechanism and whether a screenshot job is MVP or post-MVP (og:image alone is zero-dependency).
2. **LLM provider for extraction** — OpenRouter (existing embeddings provider) vs. local Ollama.
   Extraction needs a chat-capable model; confirm provider and that structured output is supported.
3. **Dedup semantics** — "merge" means: existing bookmark keeps its id; new URL wins? tags merge?
   Confirm merge policy.
4. **Vocabulary auto-creation** — auto-creating active vocabulary on import reverses the old
   "never auto-create active vocabulary" invariant. Confirm this is acceptable given the user's
   vocabulary-management stance.
5. **Summary generation timing** — synchronous during import (per the finding) adds latency per
   bookmark; consider a cap (e.g. only summarize when description is missing/empty).

## Impacted files (for the implementer)

- `packages/importer/` — parser becomes fallback; new LLM extraction module; ingest drops
  resolution/staging.
- `packages/core/src/services/import.ts` — direct commit; `review.ts` shrinks.
- `packages/db/` — drop `import_batches`; drop status columns; migration.
- `apps/web/` — new Import page (route + split layout); ImportDialog and ReviewQueue sections
  removed.
- `docs/ARCHITECTURE.md` §7, `docs/MODEL.md` — update to match.