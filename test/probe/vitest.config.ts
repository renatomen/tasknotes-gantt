/**
 * Vitest browser-mode config for the throwaway SVAR feature probe (spike).
 * Mirrors the perf isolated config's svelte(runes) + playwright/chromium setup so
 * the RAW SVAR <Gantt> compiles exactly as in production, but scopes to
 * test/probe/**\/*.probe.ts and drops the `obsidian` alias — the raw probe host
 * imports only `@svar-ui/svelte-gantt`, never `obsidian`. The perf config's
 * include (`test/perf/isolated/**\/*.perf.ts`) does not match these files, so a
 * dedicated config is required rather than reusing it.
 */
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

export default defineConfig({
  plugins: [svelte({ compilerOptions: { runes: true } })],
  test: {
    root: repoRoot,
    include: ['test/probe/**/*.probe.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      api: { allowWrite: true },
    },
    api: { allowWrite: true },
  },
});
