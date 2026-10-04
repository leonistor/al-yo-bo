import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildAiLayer } from '@al-yo-bo/ai';
import { createCore, createVectorProvider, makeScraper, type AvatarStore } from '@al-yo-bo/core';
import { checkpoint, openDatabase, setupDatabase } from '@al-yo-bo/db';
import { Hono, type Context } from 'hono';
import { serveStatic } from 'hono/bun';

import { createApp } from './app.ts';
import { loadConfig } from './env.ts';
import { EventHub } from './events.ts';
import {
  bunWebViewScreenshotClient,
  compositeScreenshotClient,
  ogImageScreenshotClient,
} from './screenshot.ts';
import { initVectorIndex } from './vector.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);

setupDatabase(db);

// One AI layer (ARCHITECTURE §8): the env is parsed once by `packages/ai` and
// the layer is built here, at the edge — core only sees the interfaces (§4).
// Every member degrades independently (§1.5).
const ai = buildAiLayer(config.ai);

// The serving stack is booted at the edge (Qdrant/vectordb never leaks into
// core); the provider lets core services observe a hot-swapped index.
const vector = await initVectorIndex(db, config);
const provider = createVectorProvider(vector.index, vector.backend);

// Real-time layer (ARCHITECTURE §9): core is the only emitter, this hub fans
// the coarse domain events out to SSE clients via GET /api/events.
const hub = new EventHub();

const scrape = makeScraper(config.scrape);

const screenshotClient = compositeScreenshotClient({
  primary: bunWebViewScreenshotClient({
    width: config.screenshot.width,
    height: config.screenshot.height,
    settleMs: config.screenshot.settleMs,
    timeoutMs: config.screenshot.timeoutMs,
  }),
  fallback: ogImageScreenshotClient({
    fetchImpl: fetch,
    timeoutMs: config.scrape.timeoutMs,
  }),
});

// Avatar bytes are a file artifact like screenshots (§5): stored under the data
// root, one file per upload (overwritten), never a BLOB in the single backup
// file. The port keeps core free of paths.
const profileDir = join(config.dataDir, 'profile');
const avatarStore: AvatarStore = {
  async save(file) {
    await mkdir(profileDir, { recursive: true });
    // One avatar file per profile: a re-upload with a different extension must
    // not leave the stale `avatar.<ext>` behind. A missing sibling is fine.
    const staleExt = file.ext === 'jpg' ? 'png' : 'jpg';
    await unlink(join(profileDir, `avatar.${staleExt}`)).catch(() => {});
    const filename = `avatar.${file.ext}`;
    await writeFile(join(profileDir, filename), file.bytes);
    return filename;
  },
  async remove(filename) {
    await unlink(join(profileDir, filename));
  },
};

const core = createCore({
  db,
  config,
  ai,
  vector: provider,
  scrape,
  screenshot: screenshotClient,
  screenshotsDir: config.screenshotsDir,
  avatarStore,
  events: hub,
  // Same cap as dead-link invalidation: a job gives up on the same attempt that
  // marks the bookmark invalid.
  maxAttempts: config.scrape.maxAttempts,
  // The `reindex` job (§10): rebuild FTS + vector serving stack from SQLite and
  // hot-swap it into the provider every service reads.
  reindex: async () => {
    const next = await initVectorIndex(db, config);
    provider.replace(next.index, next.backend);
    return { vectorBackend: next.backend };
  },
});

const app = new Hono();

// Serves screenshot artifacts from the configured screenshots dir (under the
// data root). Guarded by a UUIDv7 + `.jpg` regex so the route cannot escape it.
app.get('/data/screenshots/:filename', (c) => serveScreenshot(c, config.screenshotsDir));

// Serves the profile avatar from `<DATA_DIR>/profile/`. Only the file name
// stored on the profile row is honored, and it is regex-guarded, so the route
// cannot escape the directory. Re-uploads overwrite the same name; the web
// client cache-busts with `?v=<updatedAt>`.
app.get('/data/profile/avatar', async (c) =>
  serveProfileAvatar(c, config.dataDir, core.profile.get()?.avatarPath ?? null),
);

app.route('/', createApp(core, config, hub));

// In production the single Bun process also serves the built web app.
if (process.env.NODE_ENV === 'production') {
  app.use('*', serveStatic({ root: './apps/web/dist' }));
  app.get('*', serveStatic({ path: './apps/web/dist/index.html' }));
}

async function shutdown(): Promise<void> {
  core.stop();
  // stop() only flags the in-flight job — give it a bounded grace window to
  // finish its current db write, or checkpoint/close races it (closed-db
  // write from the job, possible SQLITE_BUSY on the checkpoint).
  await Promise.race([core.waitForIdle(), Bun.sleep(3_000)]).catch(() => {});
  checkpoint(db);
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// Startup reconciliation (ARCHITECTURE §10): recover enrichment a restart dropped.
// Embedding reconciliation only runs when the embedding client is configured.
const reconciliation = core.enrichment.reconcile();

console.log(`al-yo-bo server listening on http://${config.host}:${config.port}`);
console.log(
  `[vector] backend: ${vector.backend}${ai.embeddings ? `, query embeddings: ${config.ai.openrouter.embeddingModel}` : ', query embeddings: off'}`,
);
console.log(
  `[ai] classifier: ollaya/${config.ai.ollaya.model} — extract: ${ai.extract ? 'llm' : 'fallback (deterministic parser)'} — chat: ${config.ai.ollama.chatModel ?? 'off (set OLLAMA_CHAT_MODEL)'}`,
);
// compositeScreenshotClient always returns a client (primary + fallback), so
// there is no "disabled" state to report — log the actual composition.
console.log('[screenshot] capture: Bun.WebView primary, og:image fallback');
if (
  reconciliation.scrape +
    reconciliation.embed +
    reconciliation.reembed +
    reconciliation.screenshot >
  0
) {
  console.log(
    `[jobs] reconciling enrichment: ${reconciliation.scrape} to scrape, ${reconciliation.embed} to embed${reconciliation.reembed ? `, ${reconciliation.reembed} to re-embed (model change)` : ''}${reconciliation.screenshot ? `, ${reconciliation.screenshot} to screenshot` : ''}`,
  );
}

export type { AppType } from './app.ts';

export default { port: config.port, hostname: config.host, fetch: app.fetch };

/**
 * Screenshots are always stored as `<uuid>.jpg` (core's filename is fixed),
 * but og:image fallback bytes can be PNG/WEBP — sniff the magic bytes so the
 * served content-type matches the payload (browsers sniff anyway; cosmetic).
 */
async function sniffImageType(file: Bun.BunFile): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  if (
    head[0] === 0x52 && // R
    head[1] === 0x49 && // I
    head[8] === 0x57 && // W
    head[9] === 0x45 // E
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

async function serveScreenshot(c: Context, dir: string): Promise<Response> {
  const filename = c.req.param('filename') ?? '';
  if (!/^[0-9a-f-]{36}\.jpg$/i.test(filename)) {
    return c.json({ type: 'not_found', title: 'Not found' }, 404);
  }
  const path = `${dir}/${filename}`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return c.json({ type: 'not_found', title: 'Not found' }, 404);
  }
  return new Response(file, {
    headers: {
      'content-type': await sniffImageType(file),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

async function serveProfileAvatar(
  c: Context,
  dataDir: string,
  avatarPath: string | null,
): Promise<Response> {
  if (!avatarPath || !/^[A-Za-z0-9._-]+\.(jpg|png)$/.test(avatarPath)) {
    return c.json({ type: 'not_found', title: 'Not found' }, 404);
  }
  const file = Bun.file(join(dataDir, 'profile', avatarPath));
  if (!(await file.exists())) {
    return c.json({ type: 'not_found', title: 'Not found' }, 404);
  }
  return new Response(file, {
    headers: {
      'content-type': avatarPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
