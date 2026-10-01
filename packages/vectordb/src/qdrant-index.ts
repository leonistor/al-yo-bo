import type {
  RankedCandidate,
  VectorFilter,
  VectorIndex,
  VectorPayloadPatch,
  VectorUpsert,
} from '@al-yo-bo/shared';
import { unpackFloat32 } from '@al-yo-bo/shared';
import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';

export interface QdrantIndexOptions {
  /** Qdrant REST endpoint, e.g. `http://127.0.0.1:6333`. */
  url: string;
  /** Collection name. All bookmarks share one collection. Default `bookmarks`. */
  collection?: string;
  apiKey?: string;
  /** Client-level fetch timeout in milliseconds. Default 5_000. */
  timeoutMs?: number;
}

/** One durable embedding as stored in SQLite (`bookmark_embeddings`). */
export interface SyncRecord {
  bookmarkId: string;
  model: string;
  dims: number;
  embedding: Uint8Array;
}

export interface SyncPayload {
  categoryId: string | null;
  tagIds: string[];
}

export interface SyncReport {
  upserted: number;
  deleted: number;
  /** True when `ensureCollection` had to drop and recreate a mismatched collection. */
  recreated: boolean;
  /** True when there were no records and the target set was already empty. */
  skipped: boolean;
}

/** Filterable payload keys, each backed by a keyword index on the collection. */
const FIELD_CATEGORY = 'categoryId';
const FIELD_TAGS = 'tagIds';
const BATCH_SIZE = 200;
const SCROLL_LIMIT = 1000;

/**
 * Payload stamped on every point. `categoryId`/`tagIds` are omitted when absent
 * so payload-only syncs never accidentally clear filter fields.
 */
export function buildPointPayload(
  model: string,
  dims: number,
  payload?: SyncPayload,
): Record<string, unknown> {
  return {
    model,
    dims,
    ...(payload ? { [FIELD_CATEGORY]: payload.categoryId, [FIELD_TAGS]: payload.tagIds } : {}),
  };
}

/**
 * Translates the shared `VectorFilter` into a Qdrant filter. Both conditions are
 * ANDed in `must` (matching the keyword-search semantics); an empty filter is
 * returned as `undefined` so callers can omit the field entirely.
 */
export function buildVectorFilter(filter?: VectorFilter): Schemas['Filter'] | undefined {
  if (filter?.categoryId === undefined && filter?.tagId === undefined) {
    return undefined;
  }
  const must: Schemas['Condition'][] = [];
  if (filter.categoryId !== undefined) {
    must.push({ key: FIELD_CATEGORY, match: { value: filter.categoryId } });
  }
  if (filter.tagId !== undefined) {
    must.push({ key: FIELD_TAGS, match: { any: [filter.tagId] } });
  }
  return { must };
}

/** Splits `items` into consecutive fixed-size batches; the last batch may be smaller. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`Chunk size must be a positive integer, got ${size}`);
  }
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/**
 * Returns the shared vector dimension as encoded by `embedding.byteLength / 4`.
 * Throws on a mixed-dimension batch, mirroring the in-memory matrix invariant:
 * all vectors in one collection must be comparable.
 */
export function assertUniformDims(records: SyncRecord[]): number {
  const first = records[0];
  if (!first) {
    return 0;
  }
  const dims = first.embedding.byteLength / 4;
  for (const record of records) {
    const recordDims = record.embedding.byteLength / 4;
    if (recordDims !== dims) {
      throw new Error(`Embedding dimension mismatch: expected ${dims}, got ${recordDims}`);
    }
  }
  return dims;
}

/** The unnamed single-vector form of `VectorsConfig` (the shape this collection uses). */
interface SingleVectorShape {
  size: number;
  distance: Schemas['Distance'];
}

/** Reads the unnamed single-vector params; returns undefined for the named multi-vector form. */
function readSingleVectorParams(
  vectors: Schemas['VectorsConfig'] | undefined,
): SingleVectorShape | undefined {
  if (!vectors) {
    return undefined;
  }
  const candidate: { size?: unknown; distance?: unknown } = vectors;
  const size = candidate.size;
  const distance = candidate.distance;
  if (typeof size !== 'number') {
    return undefined;
  }
  if (distance !== 'Cosine' && distance !== 'Euclid' && distance !== 'Dot' && distance !== 'Manhattan') {
    return undefined;
  }
  return { size, distance };
}

/**
 * Qdrant-backed `VectorIndex`.
 *
 * Qdrant is a *rebuildable serving index*, exactly like FTS5 is for keywords:
 * the durable copy of every embedding lives in SQLite (`bookmark_embeddings`),
 * and this collection only holds what is needed to answer top-k fast. Data loss
 * in Qdrant is therefore not a correctness problem — `sync` replays the SQLite
 * rows and repairs the index without re-embedding anything.
 *
 * Because of that, `ensureCollection` freely drops and recreates the collection
 * when the configured dims or embedding model changed: the old vectors describe
 * a different model space, so they are useless and the next `sync` repopulates
 * from the source of truth.
 */
export class QdrantIndex implements VectorIndex {
  private readonly client: QdrantClient;
  private readonly collection: string;
  private readonly knownIds = new Set<string>();

  constructor(options: QdrantIndexOptions) {
    this.collection = options.collection ?? 'bookmarks';
    this.client = new QdrantClient({
      url: options.url,
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 5_000,
      // Server and client are pinned together in this deployment; the extra
      // version fetch only adds a confusing error line when the sidecar is down.
      checkCompatibility: false,
    });
  }

  get size(): number {
    return this.knownIds.size;
  }

  /**
   * Ensures the collection exists with the requested dimensionality and model.
   * No-op for `dims <= 0` (semantic search disabled). On a size/distance/model
   * mismatch the collection is deleted and recreated empty — `sync` is expected
   * to repopulate it. `knownIds` is left for `sync` to set.
   */
  async ensureCollection(dims: number, model: string): Promise<void> {
    await this.ensureCollectionInternal(dims, model);
  }

  private async ensureCollectionInternal(dims: number, model: string): Promise<boolean> {
    if (dims <= 0) {
      return false;
    }

    const exists = (await this.client.collectionExists(this.collection)).exists;
    if (!exists) {
      await this.createCollection(dims, model);
      return true;
    }

    const info = await this.client.getCollection(this.collection);
    const params = readSingleVectorParams(info.config.params.vectors);
    const storedModel = info.config.metadata?.['model'];
    // A missing or non-string stored model is a mismatch when a model is
    // configured: the existing points' model space is unknown, so the collection
    // must be rebuilt rather than trusted. An empty `model` means "no model
    // configured" and skips the check.
    const modelMatches = model === '' || storedModel === model;
    const shapeMatches = params?.size === dims && params.distance === 'Cosine';
    if (shapeMatches && modelMatches) {
      return false;
    }

    await this.client.deleteCollection(this.collection);
    this.knownIds.clear();
    await this.createCollection(dims, model);
    return true;
  }

  private async createCollection(dims: number, model: string): Promise<void> {
    await this.client.createCollection(this.collection, {
      vectors: { size: dims, distance: 'Cosine' },
      metadata: { model },
    });
    // Keyword indexes make the category/tag filters server-side instead of a scan.
    await this.client.createPayloadIndex(this.collection, {
      wait: true,
      field_name: FIELD_CATEGORY,
      field_schema: 'keyword',
    });
    await this.client.createPayloadIndex(this.collection, {
      wait: true,
      field_name: FIELD_TAGS,
      field_schema: 'keyword',
    });
  }

  /** Idempotent full-payload upsert. Waits for completion so reads see the write immediately. */
  async upsert(point: VectorUpsert): Promise<void> {
    await this.client.upsert(this.collection, {
      wait: true,
      points: [
        {
          id: point.bookmarkId,
          vector: Array.from(point.vector),
          payload: buildPointPayload(point.payload.model, point.payload.dims, point.payload),
        },
      ],
    });
    this.knownIds.add(point.bookmarkId);
  }

  /** Merges only the defined patch fields; a missing point is a server-side no-op. */
  async updatePayload(bookmarkId: string, patch: VectorPayloadPatch): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (patch.categoryId !== undefined) {
      payload[FIELD_CATEGORY] = patch.categoryId;
    }
    if (patch.tagIds !== undefined) {
      payload[FIELD_TAGS] = patch.tagIds;
    }
    if (Object.keys(payload).length === 0) {
      return;
    }
    await this.client.setPayload(this.collection, {
      wait: true,
      payload,
      points: [bookmarkId],
    });
  }

  async delete(bookmarkId: string): Promise<void> {
    await this.client.delete(this.collection, { wait: true, points: [bookmarkId] });
    this.knownIds.delete(bookmarkId);
  }

  async search(query: Float32Array, topK: number, filter?: VectorFilter): Promise<RankedCandidate[]> {
    if (topK <= 0) {
      return [];
    }
    const qdrantFilter = buildVectorFilter(filter);
    const response = await this.client.query(this.collection, {
      query: Array.from(query),
      limit: topK,
      ...(qdrantFilter ? { filter: qdrantFilter } : {}),
      with_payload: false,
      with_vector: false,
    });
    return response.points.map((point, index) => ({
      bookmarkId: String(point.id),
      rank: index + 1,
      score: point.score,
    }));
  }

  /**
   * Rebuilds the collection from the SQLite embedding rows: deletes every
   * existing point, then batch-upserts the complete record set. Passing no
   * records tears the collection down (semantic search disabled); an
   * already-empty target is reported as `skipped`.
   *
   * Full rebuild is a deliberate choice over reconciling by id: an id-only
   * diff cannot detect embeddings or payloads that changed *in place* in
   * SQLite, so those would silently go stale in Qdrant. At personal scale a
   * delete-all + re-upsert on startup is cheap and obviously correct; if
   * startup latency ever matters, the upgrade path is per-record content-hash
   * comparison (stored in the point payload) to skip unchanged rows.
   */
  async sync(records: SyncRecord[], resolvePayload?: (bookmarkId: string) => SyncPayload): Promise<SyncReport> {
    if (records.length === 0) {
      return this.syncEmpty();
    }

    const dims = assertUniformDims(records);
    const model = records[0]?.model ?? '';
    const recreated = await this.ensureCollectionInternal(dims, model);

    const current = await this.readPointIds();
    const target = new Set(records.map((record) => record.bookmarkId));

    let deleted = 0;
    // Deliberately sequential: bounded load on the sidecar and a deterministic
    // failure surface matter more than sync throughput at personal scale.
    for (const batch of chunk([...current], BATCH_SIZE)) {
      // oxlint-disable-next-line no-await-in-loop
      await this.client.delete(this.collection, { wait: true, points: batch });
      deleted += batch.length;
    }

    let upserted = 0;
    for (const batch of chunk(records, BATCH_SIZE)) {
      // oxlint-disable-next-line no-await-in-loop
      await this.client.upsert(this.collection, {
        wait: true,
        points: batch.map((record) => ({
          id: record.bookmarkId,
          vector: Array.from(unpackFloat32(record.embedding)),
          payload: buildPointPayload(
            model,
            dims,
            resolvePayload ? resolvePayload(record.bookmarkId) : { categoryId: null, tagIds: [] },
          ),
        })),
      });
      upserted += batch.length;
    }

    this.replaceKnownIds(target);
    return { upserted, deleted, recreated, skipped: false };
  }

  private async syncEmpty(): Promise<SyncReport> {
    const exists = (await this.client.collectionExists(this.collection)).exists;
    if (!exists) {
      this.knownIds.clear();
      return { upserted: 0, deleted: 0, recreated: false, skipped: true };
    }
    const count = (await this.client.count(this.collection, { exact: true })).count;
    if (count === 0) {
      this.knownIds.clear();
      return { upserted: 0, deleted: 0, recreated: false, skipped: true };
    }
    await this.client.deleteCollection(this.collection);
    this.knownIds.clear();
    return { upserted: 0, deleted: count, recreated: false, skipped: false };
  }

  /** Reads every point id via paginated scroll, without payloads or vectors. */
  private async readPointIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    let offset: Schemas['ExtendedPointId'] | undefined;
    // Pagination is inherently sequential: each page's offset comes from the previous response.
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop
      const page = await this.client.scroll(this.collection, {
        limit: SCROLL_LIMIT,
        with_payload: false,
        with_vector: false,
        ...(offset !== undefined ? { offset } : {}),
      });
      for (const point of page.points) {
        ids.add(String(point.id));
      }
      const next = page.next_page_offset;
      if (next === null || next === undefined || (typeof next !== 'number' && typeof next !== 'string')) {
        break;
      }
      offset = next;
    }
    return ids;
  }

  private replaceKnownIds(ids: Set<string>): void {
    this.knownIds.clear();
    for (const id of ids) {
      this.knownIds.add(id);
    }
  }
}
