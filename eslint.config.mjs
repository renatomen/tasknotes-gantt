import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default [
  // Files/folders to ignore
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".wdio-*",
      "**/.obsidian-cache/**",
      "project/**",
      "test-results/**",
      "vendor/**",
    ],
  },
  // Base JS recommended rules
  js.configs.recommended,
  // TypeScript files
  {
    files: ["**/*.{ts,tsx}"],
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
        MutationObserver: "readonly",
        setTimeout: "readonly",
        performance: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // keep initial rule set minimal; we can tighten later per standards
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
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
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      // Defer to the TS-aware rule (matches the .ts block). Core no-unused-vars
      // misfires on TS function-type parameter names (e.g. `(ev: MouseEvent) =>
      // void` in a type annotation), which aren't runtime bindings.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ["test/**/*.ts"],
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
