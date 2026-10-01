import { checkpoint, openDatabase, setupDatabase } from '@al-yo-bo/db';
import { OllayaClassifierClient } from '@al-yo-bo/classifier';
import { OpenRouterEmbeddings } from '@al-yo-bo/embeddings';
import { createCore, createVectorProvider, makeScraper } from '@al-yo-bo/core';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

import { createApp } from './app.ts';
import { loadConfig } from './env.ts';
import { initVectorIndex } from './vector.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);
setupDatabase(db);

// The serving stack is booted at the edge (Qdrant/vectordb never leaks into
// core); the provider lets core services observe a hot-swapped index.
const vector = await initVectorIndex(db, config);
const provider = createVectorProvider(vector.index, vector.backend);

const embeddings =
  config.embeddings.apiKey && config.embeddings.model
    ? new OpenRouterEmbeddings({
        apiKey: config.embeddings.apiKey,
        model: config.embeddings.model,
        baseUrl: config.embeddings.baseUrl,
      })
    : undefined;
const scrape = makeScraper(config.scrape);
// The classifier client is cheap to construct and always available; decide()
// calls fail gracefully when the daemon is down (jobs retry, §1.5).
const classifier = new OllayaClassifierClient({
  baseUrl: config.ollaya.baseUrl,
  apiKey: config.ollaya.apiKey,
});

const core = createCore({
  db,
  config,
  vector: provider,
  embeddings,
  classifier,
  scrape,
  // Same cap as dead-link invalidation: a job gives up on the same attempt that
  // marks the bookmark invalid.
  maxAttempts: config.scrape.maxAttempts,
  // The `reindex` job (§8): rebuild FTS + vector serving stack from SQLite and
  // hot-swap it into the provider every service reads.
  reindex: async () => {
    const next = await initVectorIndex(db, config);
    provider.replace(next.index, next.backend);
    return { vectorBackend: next.backend };
  },
});

const app = new Hono();
app.route('/', createApp(core, config));

// In production the single Bun process also serves the built web app.
if (process.env.NODE_ENV === 'production') {
  app.use('*', serveStatic({ root: './apps/web/dist' }));
  app.get('*', serveStatic({ path: './apps/web/dist/index.html' }));
}

function shutdown(): void {
  core.stop();
  checkpoint(db);
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Startup reconciliation (ARCHITECTURE §8): recover enrichment a restart dropped.
// Embedding reconciliation only runs when the embedding client is configured.
const reconciliation = core.enrichment.reconcile();

console.log(`al-yo-bo server listening on http://${config.host}:${config.port}`);
console.log(
  `[vector] backend: ${vector.backend}${embeddings ? `, query embeddings: ${config.embeddings.model}` : ', query embeddings: off'}`,
);
if (reconciliation.scrape + reconciliation.embed + reconciliation.reembed > 0) {
  console.log(
    `[jobs] reconciling enrichment: ${reconciliation.scrape} to scrape, ${reconciliation.embed} to embed${reconciliation.reembed ? `, ${reconciliation.reembed} to re-embed (model change)` : ''}`,
  );
}

export type { AppType } from './app.ts';

export default { port: config.port, hostname: config.host, fetch: app.fetch };
