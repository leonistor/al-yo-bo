/**
 * `list_active_vocabulary` — tags + categories the user can assign right now.
 *
 * Source of truth: `queryKeys.tags` (Tag[]) joined with `queryKeys.aggregates`
 * (TagAggregate[] carries the per-tag count). Categories come from
 * `queryKeys.categories` (CategoryNode tree). Per MODEL.md the classifier
 * never creates vocabulary, so the `source` field reports the tag's
 * assignment provenance from the tag-aggregate join — there's no
 * `classifier_suggested` state, only `user`/`import`/mixed.
 */
import type { Aggregates, CategoryNode, Tag, TagStatus } from '@al-yo-bo/shared';

import type { ToolDefinition } from '../types.ts';
import { getQueryClient } from '../client.ts';
import { queryKeys } from '@/lib/queryKeys';

type Kind = 'tag' | 'category';

interface VocabItem {
  id: string;
  label: string;
  kind: Kind;
  status: TagStatus | 'active';
  usageCount: number;
  /** Mixed provenance across assignments; 'mixed' means the tag is used both user- and import-sourced. */
  source: 'user' | 'import' | 'mixed';
}

interface ListArgs {
  kind?: Kind;
  query?: string;
  limit?: number;
}

export const listActiveVocabulary: ToolDefinition = {
  name: 'list_active_vocabulary',
  description: 'List active tag and category vocabulary with usage counts.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['tag', 'category'] },
      query: { type: 'string' },
      limit: { type: 'number', minimum: 1, maximum: 500 },
    },
    additionalProperties: false,
  },
  execute: (args) => {
    const client = getQueryClient();
    if (!client) {
      return { error: 'query_client_not_initialized', items: [], total: 0 };
    }

    const { kind, query, limit } = args as ListArgs;
    const wantKind: Kind | 'all' = kind === 'tag' || kind === 'category' ? kind : 'all';
    const max = clampInt(limit, 1, 500, 200);
    const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';

    const tags = client.getQueryData<Tag[]>(queryKeys.tags) ?? [];
    const aggregates = client.getQueryData<Aggregates>(queryKeys.aggregates) ?? null;
    const tree = client.getQueryData<CategoryNode[]>(queryKeys.categories) ?? [];

    const tagCountById = new Map<string, number>();
    const tagSourceById = new Map<string, 'user' | 'import' | 'mixed'>();
    if (aggregates) {
      // TagAggregate carries count; the per-assignment source (user/import) is
      // visible on the Tag itself but not aggregated — fall back to 'mixed'
      // when we don't have a single-source signal. We mark 'user' if the tag
      // has a non-null description (heuristic: user-authored tags carry
      // descriptions, imported ones rarely do) and 'import' otherwise.
      for (const t of aggregates.tags) {
        tagCountById.set(t.id, t.count);
        const match = tags.find((x) => x.id === t.id);
        tagSourceById.set(t.id, match?.description ? 'user' : 'import');
      }
    }

    const items: VocabItem[] = [];

    if (wantKind === 'all' || wantKind === 'tag') {
      for (const tag of tags) {
        if (tag.status !== 'active') {
          continue;
        }
        if (needle && !tag.name.toLowerCase().includes(needle)) {
          continue;
        }
        items.push({
          id: tag.id,
          label: tag.name,
          kind: 'tag',
          status: tag.status,
          usageCount: tagCountById.get(tag.id) ?? 0,
          source: tagSourceById.get(tag.id) ?? 'mixed',
        });
      }
    }

    if (wantKind === 'all' || wantKind === 'category') {
      const flat = flatten(tree);
      for (const cat of flat) {
        if (needle && !cat.name.toLowerCase().includes(needle)) {
          continue;
        }
        const count = aggregates?.categories.find((c) => c.id === cat.id)?.count ?? 0;
        items.push({
          id: cat.id,
          label: cat.name,
          kind: 'category',
          status: 'active',
          usageCount: count,
          source: 'user',
        });
      }
    }

    items.sort((a, b) => b.usageCount - a.usageCount || a.label.localeCompare(b.label));
    return {
      total: items.length,
      count: Math.min(items.length, max),
      items: items.slice(0, max),
    };
  },
};

function flatten(tree: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (nodes: CategoryNode[]): void => {
    for (const n of nodes) {
      out.push(n);
      if (n.children.length > 0) {
        walk(n.children);
      }
    }
  };
  walk(tree);
  return out;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
