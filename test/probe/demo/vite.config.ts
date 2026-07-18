/**
 * Standalone dev server for the split-task spike demo. Serves an interactive
 * page so the prototype can be judged by eye, independent of the test runner.
 */
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [svelte({ compilerOptions: { runes: true } })],
  server: { port: 5178, strictPort: true, open: false },
});
