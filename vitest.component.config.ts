import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Real Svelte component render tests need the "browser" package export condition
// (the SvelteKit Vite plugin otherwise resolves the server/SSR build of .svelte files,
// which does not support onMount/effects) plus a DOM environment. Kept separate from
// vite.config.ts so the node-environment unit/integration/contract suite is unaffected.
export default defineConfig({
  plugins: [sveltekit()],
  resolve: { conditions: ['browser'] },
  test: {
    environment: 'happy-dom',
    include: ['tests/component/**/*.render.test.ts']
  }
});
