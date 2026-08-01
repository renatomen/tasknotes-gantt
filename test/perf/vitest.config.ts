/**
 * Vitest browser-mode config for the isolated real-SVAR harness. Runs the real
 * `GanttContainer` Svelte component in headless Chromium so SVAR's Svelte-5
 * source compiles exactly as in production and DOM interactions, layout, and
 * timing measurements are real.
 *
 * Scope: the browser specs under test/perf/isolated (the *.perf.ts files).
 * Jest still owns the unit *.test.ts files in a node env — the globs don't
 * overlap, so the two runners coexist.
 */
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

export default defineConfig({
  // Mirror production: SVAR components are authored for Svelte 5 runes.
  plugins: [svelte({ compilerOptions: { runes: true } })],
  resolve: {
    alias: {
      // `obsidian` has no browser build; alias to an inert shim (KD2).
      obsidian: path.resolve(here, 'isolated', 'obsidian-shim.ts'),
    },
  },
  test: {
    root: repoRoot,
    include: ['test/perf/isolated/**/*.perf.ts'],
    // Keep functional browser mounts from contending with wall-clock perf measurements.
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      // Let the perf gate persist its wall-clock trend JSON via the built-in
      // `server.commands.writeFile` (U6); the write is best-effort and never
      // fails the gate.
      api: { allowWrite: true },
    },
    api: { allowWrite: true },
  },
});
