import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      // Local screenshot artifacts (ARCHITECTURE §8). Without this, Vite's SPA
      // fallback serves index.html for /data/screenshots/*.jpg and every <img>
      // fails to decode.
      '/data': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
});
