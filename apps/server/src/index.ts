import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

import { checkpoint, openDatabase, setupDatabase } from '@al-yo-bo/db';

import { createApp } from './app.ts';
import { loadConfig } from './env.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);
setupDatabase(db);

const app = new Hono();
app.route('/', createApp(db, config));

// In production the single Bun process also serves the built web app.
if (process.env.NODE_ENV === 'production') {
  app.use('*', serveStatic({ root: './apps/web/dist' }));
  app.get('*', serveStatic({ path: './apps/web/dist/index.html' }));
}

function shutdown(): void {
  checkpoint(db);
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`al-yo-bo server listening on http://${config.host}:${config.port}`);

export type { AppType } from './app.ts';

export default { port: config.port, hostname: config.host, fetch: app.fetch };
