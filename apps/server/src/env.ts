import { join } from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  autoAssignThreshold: number;
  ollaya: {
    baseUrl: string;
    apiKey?: string;
    model: string;
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Anchored to the repo root so `bun run dev` (which runs with the package as cwd)
// and `bun run db:seed` point at the same SQLite file.
const DEFAULT_DB_PATH = join(import.meta.dir, '../../../data/bookmarks.db');

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    port: numberFromEnv(env.PORT, 3000),
    host: env.HOST ?? '127.0.0.1',
    dbPath: env.DB_PATH ?? DEFAULT_DB_PATH,
    autoAssignThreshold: numberFromEnv(env.AUTO_ASSIGN_THRESHOLD, 0.5),
    ollaya: {
      baseUrl: env.OLLAYA_URL ?? 'http://127.0.0.1:11435',
      apiKey: env.OLLAYA_API_KEY,
      model: env.OLLAYA_MODEL ?? 'laya',
    },
  };
}
