# al-yo-bo rewrite — research & plan (backend · data model · AI layer)

> Compiled 2026-10-04 from three parallel research lanes: backend-candidate web research (versions
> verified Oct 2026), TypeScript AI-library research, and a code-level coupling map of the current
> data model. Order follows the brief: backend, then data model, then AI library. Young projects
> are acceptable (Ollaya itself is pre-1.0).
>
> **Status: decisions confirmed 2026-10-04 (Leo):** T3 backend · global URL uniqueness · tag dedupe
> rule as specified in §3.3.

## 0. TL;DR

| Area | Decision |
|---|---|
| **Backend** | **Keep Bun + Hono (topology T3) — confirmed.** Real-time arrives as an in-process event bus → Hono `streamSSE()` → TanStack Query invalidation. No new backend, no new store. PocketBase (T2) documented as the evaluated-and-declined alternative (§2.4). |
| **Data model** | **Adopt all three slimming changes in one migration wave (0009)**: profile absorbs dataset; `sections` dropped for an orderable `categories` tree (`parent_id`, `sort_order`); tags lose `category_id`. Global URL uniqueness confirmed. |
| **AI layer** | **AI SDK 7** (already in the stack for chat + import extraction) consolidated into one `packages/ai`: central typed config, provider registry, AI-SDK-based embeddings. **Ollaya stays a bespoke decision-model client** — it is not an LLM gateway. |
| **MCP** | Bookmarks MCP server on the **official MCP TypeScript SDK v2** with its first-party **Hono adapter**, mounted in the existing server. |

## 1. Context

The stack today (ARCHITECTURE §2): one Bun process = Hono API + in-process job worker; one durable
SQLite file (relational + FTS5 + durable vector BLOBs); Qdrant sidecar for vector serving; Ollaya
decision daemon for classification; OpenRouter for embeddings; AI SDK 7 already powers chat
(`streamText`/`useChat`) and import extraction (`generateText` + `Output.object`). React 19 client
uses Hono RPC + TanStack Query — **no polling, no SSE, no WebSockets**; dataset switching is
boot-time only.

Unhappiness driving the rewrite: dataset/section scoping adds weight without payoff; real-time
updates are missing; AI access is fragmented across bespoke clients; no MCP story.

## 2. Backend research

### 2.1 Candidates (verified Oct 2026)

- **PocketBase** v0.40.4 (Sep 2026, MIT, 61k★) — one ~12 MB Go binary, embedded SQLite, **SSE
  real-time subscriptions**, auth (password/OAuth2/OTP), files, rewritten admin UI. Extensions via
  Go framework or embedded JS (goja, ES5-ish, no Node APIs). **No DB-level foreign keys** (relations
  are app-level); **FTS5 is compiled in but unsupported/unplanned** (manual virtual tables +
  triggers); **vectors require a custom CGO build** with `sqlite-vec` (prebuilt binary no longer
  suffices). Pre-1.0 with documented breaking migrations (v0.23 "1h to a weekend").
- **Convex** self-hosted (`convex@1.46.0`, FSL Apache-2.0) — Rust backend + TS functions in a custom
  V8 runtime; genuinely excellent **reactive `searchIndex`/`vectorIndex`**; default storage is its
  own SQLite (or Postgres/MySQL) with opaque internal migrations. No Bun function runtime;
  multi-service deployment; self-host support is community-only.
- **Hono on Bun (status quo+)** — `streamSSE()` built in, Bun WebSocket adapter (`hono/bun`),
  type-safe RPC already in use. `bun:sqlite` has no update hooks; live-query options are a
  trigger-based change-log outbox or `PRAGMA data_version` polling, fanned out in-process.
  **Elysia/Eden rejected**: same tool class, switching buys nothing.
- **Wildcards rejected**: Rocicorp Zero 1.0 (needs Postgres + multi-container), LiveStore 0.4
  (client-layer, needs a sync backend), ElectricSQL (Postgres logical replication only), tRPC
  (duplicates Hono RPC).

### 2.2 Topologies

- **T1 — PocketBase as persistence-only behind Hono**: rejected; two frameworks sharing one
  schema/migration ownership is fragile.
- **T2 — PocketBase as *the* backend + store**: coherent (Bun monorepo keeps importer/exporter/MCP
  and shared domain libs; web talks to PB, realtime native). Costs: strict FKs gone, FTS5
  hand-managed, custom CGO binary for vectors, pre-1.0 churn, classifier evidence logic rewritten
  as hooks/Go.
- **T3 — keep Hono/Bun, add real-time**: preserves every §1 constraint (one durable SQLite file,
  FTS5, strict FKs, `packages/db` owns SQL, graceful degradation). Only new work is the real-time
  layer. **Confirmed.**
- **T4 — Convex as the backend**: rejected — store replaced wholesale, domain logic rewritten as
  Convex functions, multi-container runtime, FSL license, no Bun runtime.

### 2.3 Decision — T3, with a concrete real-time design

Since the API and the job worker already share one Bun process, **every app write passes through our
own code** — so the simplest robust design is a **service-layer event bus** (core services emit
coarse events like `bookmarks.changed`, `vocabulary.changed`, `profile.changed`; an SSE endpoint
subscribes and pushes; the client maps events to TanStack `invalidateQueries`). Zero schema changes,
no triggers. Upgrade path: a trigger-based `change_log` outbox in SQLite if out-of-process writers
(CLI scripts) ever need to appear live. Record-level PocketBase-style subscriptions are deliberately
deferred.

What this buys immediately: live list/search/tag updates without refresh, and job progress
(scrape→embed→classify) surfacing in the UI as it happens. What it costs: ~hand-rolled fan-out —
small, testable, and ours.

### 2.4 Alternative on record (declined 2026-10-04)

PocketBase as backend+store (T2) remains the documented alternative if constraints ever change
(e.g., multi-device sync appetite, desire for record-level SSE and turnkey admin/auth). Re-entry
costs to remember then: lose strict FKs and the typed SQL layer, hand-managed FTS5, custom CGO build
for `sqlite-vec`, pre-1.0 upgrade churn, classifier evidence logic rewritten as hooks/Go.

## 3. Data model

### 3.1 What the code says today (recon highlights)

- **`datasets` carries no settings** — only `id, name, created_at`
  (`0003_dataset_vocabulary.sql:11-17`). The "merge into profile" is a **deletion of a scope layer,
  not a fold**. Profile already exists as the singleton person (`0007_profile.sql`); seeding already
  duplicates name fields (`seed.ts:164-174`). Threading: 63 files / 967 `dataset` occurrences —
  every query module, every core service, boot resolution (`create-core.ts:79`), import route,
  vector payload + Qdrant payload index (`qdrant-index.ts:45,79-94`), fallback filter, seeds.
- **`sections` have no ordering** (`ORDER BY name` everywhere, `sections.ts:14`); no
  `parent_id`/`sort_order` exists anywhere. Real usage surface: `queries/sections.ts`, vocabulary
  service, `/api/sections`, aggregates, export grouping, web Sidebar/VocabularyPage. The importer
  already ignores sections (H2/H3 collapse into one `category` field) — only the **exporter** still
  emits `## Section`/`### Category`.
- **Tags**: scoping is the nullable `tags.category_id` + two partial unique indexes. It drives the
  classifier candidate query (`classification.ts:38-54` — active tags of the bookmark's category +
  unscoped) and a scoped-tag-wins name rule (`classify.ts:99-119`). Removing it is a **behavioral
  change** (broader candidate set), not just a schema edit.
- Scale: migrations 8; LOC — web 16.6k, core 3.2k, db 2.5k, server 1.7k, others ≤0.5k.

### 3.2 Target model

```
profile (singleton)   person + identity — drops active_dataset_id
categories            id, parent_id → categories(id) NULL, sort_order INT NOT NULL,
                      name UNIQUE, description, created_at        (unlimited-depth tree; cycle-checked in app)
bookmarks             url UNIQUE (global), …, category_id → categories ON DELETE SET NULL
tags                  name UNIQUE, description, status active|deprecated, created_at   (no category_id, no dataset_id)
bookmark_tags / classification_runs / classification_results / unknown_classification_labels /
bookmark_fts / bookmark_embeddings   — unchanged except dataset threading disappears
```

Model principles that survive untouched: evidence vs effective state (runs/results immutable),
classifier never invents vocabulary, active-only auto-assignment, user rows win. Deleted
principles: dataset scoping (MODEL.md 1) and the section/category two-level split (MODEL.md 2).

Pleasant consequence: the markdown collection format becomes exactly the tree — **H2 → level-1
category, H3 → child category** — so the current H2/H3-flattening hack and the exporter's
section/grouping machinery both disappear, and import/export round-trip gets *better*, not worse.

### 3.3 Migration wave 0009 (one forward-only migration) + code fallout

1. Rebuild `categories`: add `parent_id`/`sort_order`; existing sections become top-level
   categories with their categories as children; drop `sections`.
2. Drop `dataset_id` from `bookmarks`/`categories`/`tags`; URL unique → **global (confirmed)**.
   Defensive URL dedupe in-migration: if the same URL exists in two datasets, keep the earliest
   `created_at` row and cascade-delete the rest (dev data is disposable; reseed is the sanctioned
   path).
3. Tags: drop `category_id`; **dedupe rule (confirmed)** — when the same tag name exists in multiple
   category scopes, the survivor is chosen by: (a) `active` beats `deprecated`; (b) more effective
   `bookmark_tags` rows wins; (c) earliest `created_at` breaks ties. Re-point `bookmark_tags` and
   `classification_results.tag_id` to the survivor, delete losers (their evidence rows
   cascade-delete — acceptable: dev data is disposable, reseed is sanctioned). Then one global
   unique index on name.
4. Drop `datasets` + `profile.active_dataset_id`; delete `resolveActiveDataset`,
   `DEFAULT_DATASET`; simplify `SEED_*` (dev isolation already handled by scratch `DATA_DIR`).
5. Qdrant: payload drops `datasetId` → `{ model, dims, categoryId, tagIds }`; extend the startup
   drop-and-recreate check to a payload version.

Blast radius: dataset merge **Medium/Large but mechanical** (threading removal); category tree
**Medium** (net-new ordering + drag-reorder UI in web); tag independence **small-medium schema + one
behavioral test** for the broader classifier candidate set (per-call cap already exists).

## 4. AI library

### 4.1 Correction first: what Ollaya is

Ollaya is a **decision-model server** (TypeSafe-compatible): typed `choice`/`score`/`noul` questions
over a state → calibrated probabilities; it **never generates text** and exposes no
OpenAI-compatible endpoints (its `/api/generate`, `/api/chat`, `/api/embed` 404). So it can never be
an AI SDK provider, and the current `ClassifierClient` models it correctly — it stays, but
*configured centrally*. It already ships its own MCP server, so it is something we *expose to*
agents, not wrap.

### 4.2 Comparison (verified Oct 2026)

| | AI SDK 7 (`ai@7.0.x`) | Mastra 1.x | MCP TS SDK v2 | LangGraph.js | OpenAI/Claude Agent SDKs |
|---|---|---|---|---|---|
| Bun | ✅ (ESM, Node 22+) | ⚠️ build friction (#11575) | ✅ + Hono adapter | ⚠️ Node-centric | ⚠️ Node-centric |
| Structured output / tools | ✅ `Output.object`, ToolLoopAgent, approvals | ✅ | tool schemas only | ✅ | ✅ |
| MCP client / **server** | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ **canonical** | via adapters | client-ish |
| Providers | ✅ 25+, `createOpenAICompatible`, registry; OpenRouter provider incl. embeddings | wraps AI SDK | n/a | any | **locked to one vendor** |
| Weight / license | 🟢 ~67 kB, Apache-2.0 | 🔴 framework + Studio, ee/ dirs | 🟢 MIT | 🟡 | 🔴 Claude SDK non-OSS |

**Decision: AI SDK 7 as the one AI layer; MCP TS SDK v2 (`@modelcontextprotocol/server` +
`@modelcontextprotocol/hono`) for the bookmarks MCP server.** AI SDK is an MCP *client* only — using
the official SDK for server authoring is the correct split. Mastra is the runner-up and rejected as
overkill (it wraps AI SDK anyway).

### 4.3 Target: one `packages/ai`

```
packages/ai/
  config.ts      one zod schema over today's env (OLLAYA_*, OLLAMA_*, OPENROUTER_*,
                 EMBEDDING_MODEL, EXTRACT_MODEL, AUTO_ASSIGN_THRESHOLD) — parsed once
  registry.ts    createProviderRegistry({ openrouter, local? })   (explicit instances)
  embedding.ts   embed/embedMany behind the EmbeddingClient contract — deletes the hand-rolled
                 OpenRouter HTTP adapter (packages/embeddings → merged here)
  classifier.ts  Ollaya adapter kept as ClassifierClient, constructed from central config
  health.ts      capability probes → the existing degrade flags
  index.ts       buildAiLayer(config) → single construction point injected into core
```

Staged adoption: (1) embeddings via AI SDK first, validate on Bun; (2) absorb classifier config;
(3) agents (`ToolLoopAgent`) when features need them. Cross-cutting retries/timeouts/telemetry come
from AI SDK middleware + `@ai-sdk/otel` — deleting duplicated config plumbing today spread across
`packages/classifier` and `packages/embeddings` (104 LOC each, same timeout/error patterns).

### 4.4 Bookmarks MCP server (first version)

Mounted in the existing Hono app via `createMcpHonoApp()` (adds localhost Host/Origin DNS-rebinding
guard): tools `search_bookmarks` (hybrid search path), `get_bookmark`, `list_categories`/`list_tags`
— read-only; bookmarks as **resources** (`bookmark://{id}`) not just tools; optional stdio build for
Claude Desktop later. Consumed by our own agents via `@ai-sdk/mcp` (`client.tools()`).

## 5. Execution plan (phased, each independently shippable)

- **A — Data model consolidation** (biggest; docs-first: MODEL.md + ARCHITECTURE §1.3/§5/§7
  rewritten with the decision, then migration 0009, then package-by-package threading removal, web
  sidebar/vocabulary/import-export UI, tests).
- **B — Real-time layer** (event bus + `streamSSE` + client invalidation; job-progress events) —
  after A so event topics match final tables.
- **C — `packages/ai` consolidation** (embeddings → classifier config → registry/health) — parallel
  with B.
- **D — MCP server** — depends on A + C.

## 6. Risks

- **Classifier candidates broaden** to all active tags — more questions per call; per-call cap
  exists; watch precision.
- **Tree cycles / depth** — app-enforced parent validation; no SQL-level guard possible with
  self-FK + SQLite.
- **In-migration dedupes delete evidence rows** for loser tags/duplicate URLs — acceptable because
  dev data is disposable (reseed sanctioned); documented in MODEL.md.
- **Single-node assumption**: any future multi-user/remote ambition reopens the backend choice (see
  §2.4 for the re-entry costs).
- Verify-before-build item: Bun SSE behavior under load (chat already streams — low risk).

## 7. Sources

PocketBase: releases v0.40.x, realtime API docs, JS/Go overview, FTS5 issue #193/#5225, sqlite-vec
discussions #4632/#6140, relations #565/#155 · Convex: self-hosting docs, convex-backend repo,
runtimes, search indexes · Hono: streaming/WebSocket/RPC docs · Elysia docs ·
Zero/LiveStore/ElectricSQL status pages · AI SDK: v7 GA blog + migration guide, provider registry,
custom providers, MCP docs, `@openrouter/ai-sdk-provider`, Bun issue #12799 · MCP TS SDK v2 + Hono
guide (`ts.sdk.modelcontextprotocol.io/v2`) · Ollaya: ollaya.dev/docs (API, FAQ, TypeSafe
compatibility) · Mastra: 1.0 announcement, Bun issue #11575. Full link list preserved in the
research session notes.
