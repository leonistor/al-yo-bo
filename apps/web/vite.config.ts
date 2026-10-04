import type { ServerResponse } from 'node:http';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { HttpProxy } from 'vite';
import { defineConfig } from 'vite';

const API_TARGET = 'http://127.0.0.1:3000';

// Shared across proxy instances so a burst of failed /api + /data calls logs
// a single notice, not one per prefix.
let lastBootNotice = 0;

// `bun run dev` boots every lane in parallel: Vite listens within ~160ms while
// the API server needs ~1.5s (Qdrant wait + collection sync). An already-open
// tab reconnects and fires /api + /data calls into that window, and Vite's
// default proxy handler dumps a full ECONNREFUSED stack per request. Vite
// registers its own 'error' listener *after* configure() runs, so a plain
// on('error') can't replace it — intercept emit instead and swallow exactly
// the expected boot failure: one calm notice per 10s, 503 to the client so
// React Query retries recover the page. All other proxy errors fall through
// to Vite's loud default (config mistakes must stay visible).
function silenceBootErrors(proxy: HttpProxy.ProxyServer): void {
  // Widen the overloaded EventEmitter emit to a single rest-param signature so
  // the unknown[] spread below typechecks.
  const originalEmit = proxy.emit.bind(proxy) as (
    event: string | symbol,
    ...args: unknown[]
  ) => boolean;
  proxy.emit = (event: string | symbol, ...args: unknown[]): boolean => {
    if (event !== 'error') return originalEmit(event, ...args);
    const err = args[0] as NodeJS.ErrnoException | undefined;
    if (err?.code !== 'ECONNREFUSED') return originalEmit(event, ...args);
    const now = Date.now();
    if (now - lastBootNotice > 10_000) {
      lastBootNotice = now;
      console.warn(
        `[web] API backend (${API_TARGET}) not up yet — still booting; client requests retry automatically`,
      );
    }
    // Web requests get a ServerResponse, ws upgrades a raw socket; only the
    // former can be answered (http-proxy does NOT end it before emitting).
    const res = args[2] as ServerResponse | undefined;
    if (typeof res?.writeHead === 'function' && !res.headersSent && !res.writableEnded) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('API backend not up yet');
    }
    return true;
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Listen on all interfaces so the dev server is reachable from other
    // devices on the LAN (phone, tablet) — API calls still proxy to 127.0.0.1.
    host: '0.0.0.0',
    // QR codes printed by scripts/dev-qr.ts encode port 5173; fail loudly
    // instead of silently drifting to another port if 5173 is taken.
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure: silenceBootErrors,
      },
      // Local screenshot artifacts (ARCHITECTURE §8). Without this, Vite's SPA
      // fallback serves index.html for /data/screenshots/*.jpg and every <img>
      // fails to decode.
      '/data': {
        target: API_TARGET,
        changeOrigin: true,
        configure: silenceBootErrors,
      },
    },
  },
});
