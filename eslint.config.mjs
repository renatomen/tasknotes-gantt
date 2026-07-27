import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  // Files/folders to ignore
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "website/site/**",
      "coverage/**",
      ".wdio-*",
      "**/.obsidian-cache/**",
      "project/**",
      "test-results/**",
      "vendor/**",
      // Local-only e2e probes (gitignored, point at private vaults; never committed)
      "test/specs/_local-*",
    ],
  },
  // Base JS recommended rules
  js.configs.recommended,
  // TypeScript files
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: "readonly",
        window: "readonly",
        document: "readonly",
        HTMLElement: "readonly",
        KeyboardEvent: "readonly",
        MutationObserver: "readonly",
        setTimeout: "readonly",
        performance: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      sonarjs,
    },
    rules: {
      // keep initial rule set minimal; we can tighten later per standards
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "sonarjs/cognitive-complexity": ["error", 15],
      "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: [
      "scripts/**/*.{js,mjs,cjs}",
      "vite.config.ts",
      "*.config.{js,mjs,ts}",
      "version-bump.mjs",
    ],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      // Tooling/config files are not the production code the size gate targets.
      "max-lines": "off",
    },
  },
  // Svelte files
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        performance: 'readonly'
      }
    },
    plugins: {
      svelte: sveltePlugin,
      '@typescript-eslint': tsPlugin,
      sonarjs
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      // Defer to the TS-aware rule (matches the .ts block). Core no-unused-vars
      // misfires on TS function-type parameter names (e.g. `(ev: MouseEvent) =>
      // void` in a type annotation), which aren't runtime bindings.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'sonarjs/cognitive-complexity': ['error', 15],
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }]
    }
  },
  // max-lines is scoped to production code only: spec/probe length is not the
  // complexity the size gate targets.
  {
    files: ["test/**"],
    rules: {
      "max-lines": "off",
    },
  },
  // max-lines legacy exemptions: these files were already over the cap when the
  // gate was armed. This list may only shrink — never add to it.
  {
    files: [
      "src/bases/GanttContainer.svelte",
      "src/bases/register.ts",
      "src/controller/GanttController.ts",
      "src/datasource/TaskNotesSource.ts",
      "src/editor/CalendarEditorForm.svelte",
      "src/bases/ganttSync.ts",
      "src/bases/barTreatment.ts",
      "src/bases/viewOptions.ts",
      "src/bases/cellEditCommit.ts",
      "src/bases/cascadeGate.ts",
      "src/bases/calendarShading.ts",
      "src/bases/services/BasesDataAdapter.ts",
      "src/controller/InstanceExpansion.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  // Per-file complexity ceilings, frozen at the values measured when the gate
  // was armed. A ceiling may only decrease; growth past it fails lint. The three
  // drag-path hotspots in GanttContainer.svelte keep per-function disables
  // instead because the executor refactor deletes those functions outright.
  {
    files: ["test/__mocks__/obsidian.ts"],
    rules: { "sonarjs/cognitive-complexity": ["error", 23] },
  },
  {
    files: ["test/probe/_diag.probe.ts"],
    rules: { "sonarjs/cognitive-complexity": ["error", 21] },
  },
  {
    files: ["test/specs/gantt-resultset-loop.e2e.ts"],
    rules: { "sonarjs/cognitive-complexity": ["error", 17] },
  },
  {
    files: ["test/specs/gantt-perf-fullstack.perf.e2e.ts", "test/specs/gantt-resultset-storm.perf.e2e.ts"],
    rules: { "sonarjs/cognitive-complexity": ["error", 16] },
  },
  {
    files: ["test/**/*.{ts,mts}"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        before: "readonly",
        after: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        jest: "readonly",
      },
    },
  },
];
