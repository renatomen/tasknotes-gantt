/**
 * Vitest browser-mode config for the SVAR probe gate: real SVAR components
 * mounted in headless Chromium and driven by real pointer events, gated in CI.
 * This is the fastest honest level for bar-visual and tooltip contracts — the
 * level where defects shipped past a fully green jest suite, because jest's
 * testMatch never reaches a component.
 *
 * Mirrors the perf isolated config's svelte(runes) + playwright/chromium setup
 * so the RAW SVAR <Gantt> compiles exactly as in production, but scopes to
 * test/probe/**\/*.probe.ts and aliases `obsidian` to the perf harness's inert
 * shim so plugin components can mount too. The perf config's include
 * (`test/perf/isolated/**\/*.perf.ts`) does not match these files, so a
 * dedicated config is required rather than reusing it.
 */
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `obsidian` has no browser build; plugin components that import it (via
// lucideIconAction, modals) mount against the same inert shim the isolated
// perf harness uses. Raw-SVAR probe hosts never touch it.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

export default defineConfig({
  plugins: [svelte({ compilerOptions: { runes: true } })],
  resolve: {
    alias: {
      obsidian: path.resolve(repoRoot, 'test', 'perf', 'isolated', 'obsidian-shim.ts'),
    },
  },
  test: {
    root: repoRoot,
    include: ['test/probe/**/*.probe.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Wide enough that a chart-area screenshot captures the bars, not just the grid.
      viewport: { width: 1280, height: 640 },
      instances: [{ browser: 'chromium' }],
      api: { allowWrite: true },
    },
    api: { allowWrite: true },
  },
});
