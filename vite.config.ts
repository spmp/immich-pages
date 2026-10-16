import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

export default defineConfig({
  server: { allowedHosts: true },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  ssr: { noExternal: ['maplibre-gl'] },
  plugins: [sveltekit(), {
    name: 'favicon-content-type',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url ?? '/', 'http://localhost').pathname === '/favicon.ico') {
          response.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'public, max-age=86400' });
          response.end(readFileSync('static/favicon.ico'));
          return;
        }
        next();
      });
    }
  }],
  test: {
    exclude: ['tests/e2e/**', '**/node_modules/**', 'tests/component/**/*.render.test.ts'],
    environment: 'node'
  }
});
