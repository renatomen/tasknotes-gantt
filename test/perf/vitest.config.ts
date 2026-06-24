/**
 * Vitest browser-mode config for the isolated render harness (#161 perf plan,
 * KD1/U3). Runs the real `GanttContainer` Svelte component in headless Chromium
 * so SVAR's Svelte-5 source compiles exactly as in production and DOM-node /
 * timing measurements are real (jsdom cannot measure layout/virtualization).
 *
 * Scope: the perf specs under test/perf/isolated (the *.perf.ts files). Jest
 * still owns the unit *.test.ts files in a node env — the globs don't overlap,
 * so the two runners coexist.
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
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
