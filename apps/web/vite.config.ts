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
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      // Local screenshot artifacts (ARCHITECTURE §8). Without this, Vite's SPA
      // fallback serves index.html for /data/screenshots/*.jpg and every <img>
      // fails to decode.
      '/data': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
});
