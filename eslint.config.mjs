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
    },
  },
  {
    files: [
      "scripts/check-review-receipts.mjs",
      "scripts/releaseFiles.mjs",
    ],
    plugins: {
      sonarjs,
    },
    rules: {
      "sonarjs/cognitive-complexity": ["error", 15],
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
      'sonarjs/cognitive-complexity': ['error', 15]
    }
  },
  // A case that only awaits a `waitUntil` looks like a test and is not one: the
  // wait proves something settled, never what it settled TO, so the case passes
  // whenever its predicate is satisfiable at all. Seven cases in this suite were
  // that shape. The rule ships with a plugin already in this config and reads
  // the code through the same parser and scope analysis as every other rule
  // here, which is why there is no bespoke checker beside it.
  {
    files: ["test/**/*.ts"],
    rules: {
      "sonarjs/assertions-in-tests": "error",
    },
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
