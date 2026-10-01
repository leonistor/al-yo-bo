import { checkpoint, openDatabase, setupDatabase } from '@al-yo-bo/db';
import { OllayaClassifierClient } from '@al-yo-bo/classifier';
import { OpenRouterEmbeddings } from '@al-yo-bo/embeddings';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

import { createApp, type AppServices } from './app.ts';
import { loadConfig } from './env.ts';
import { reconcileEnrichment, startJobQueue } from './jobs.ts';
import { makeScraper } from './scrape.ts';
import { initVectorIndex } from './vector.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);
setupDatabase(db);

const vector = await initVectorIndex(db, config);
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
const jobs = startJobQueue({
  db,
  vector: vector.index,
  embeddings,
  scrape,
  classifier,
  config,
  // Content changes flow scrape → embed → classify (§6 re-run triggers).
  onEmbedded: (bookmarkId) => jobs.enqueue(bookmarkId, 'classify'),
});

const app = new Hono();
const services: AppServices = {
  vector: vector.index,
  vectorBackend: vector.backend,
  embeddings,
  jobs,
  scrape,
  classifier,
  // The `reindex` job (§8): rebuild FTS + vector serving stack from SQLite and
  // hot-swap it into the same services object every request reads.
  reindex: async () => {
    const next = await initVectorIndex(db, config);
    services.vector = next.index;
    services.vectorBackend = next.backend;
    return { vectorBackend: next.backend };
  },
};
app.route('/', createApp(db, config, services));

// In production the single Bun process also serves the built web app.
if (process.env.NODE_ENV === 'production') {
  app.use('*', serveStatic({ root: './apps/web/dist' }));
  app.get('*', serveStatic({ path: './apps/web/dist/index.html' }));
}

function shutdown(): void {
  jobs.stop();
  checkpoint(db);
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Startup reconciliation (ARCHITECTURE §8): recover enrichment a restart dropped.
// Embedding reconciliation only runs when the embedding client is configured.
const reconciliation = reconcileEnrichment(
  jobs,
  db,
  embeddings ? config.embeddings.model : undefined,
);

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
