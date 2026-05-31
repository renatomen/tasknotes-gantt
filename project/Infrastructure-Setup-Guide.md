# Obsidian Gantt Plugin - Infrastructure Setup Guide

## Overview

This document provides a complete blueprint for setting up the development infrastructure for the
Obsidian Gantt plugin from scratch. It includes all CI/CD pipelines, build systems, testing
frameworks, and development tooling.

## 1. Project Structure

```
obsidian-gantt/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .husky/
│   └── pre-commit
├── scripts/
│   ├── build.mjs
│   ├── build-local.mjs
│   ├── e2e-local.mjs
│   └── install-to-vault.cjs
├── src/
│   └── main.ts
├── test/
│   ├── specs/
│   │   └── smoke.e2e.ts
│   ├── unit/
│   ├── integration/
│   └── wdio/
│       └── wdio.conf.mts
├── dist/
├── .gitignore
├── eslint.config.mjs
├── jest.config.mjs
├── manifest.json
├── package.json
├── svelte.config.js
├── tsconfig.json
└── vite.config.ts
```

## 2. Package Configuration

### package.json

```json
{
  "name": "obsidian-gantt",
  "version": "0.0.1",
  "private": true,
  "description": "Svelte-based Gantt charts (SVAR Svelte Gantt) for Obsidian with Bases/Dataview integration.",
  "author": "Your Name / Open Source Community",
  "license": "GPL-3.0",
  "type": "module",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "vite build",
    "postbuild": "node scripts/install-to-vault.cjs",
    "dev": "vite build --watch",
    "test": "jest --passWithNoTests",
    "lint": "eslint . --ext .ts,.svelte",
    "typecheck": "svelte-check --tsconfig tsconfig.json",
    "format": "prettier --write .",
    "e2e": "wdio run ./test/wdio/wdio.conf.mts",
    "build:local": "vite build",
    "e2e:local": "node scripts/e2e-local.mjs",
    "prepare": "husky"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^6.2.1",
    "@swc/core": "^1.13.5",
    "@swc/jest": "^0.2.39",
    "@types/jest": "^30.0.0",
    "@types/node": "^24.5.2",
    "@typescript-eslint/eslint-plugin": "^8.44.0",
    "@typescript-eslint/parser": "^8.44.0",
    "@wdio/cli": "^9.19.2",
    "@wdio/globals": "^9.17.0",
    "@wdio/mocha-framework": "^9.19.2",
    "@wdio/types": "^9.19.2",
    "builtin-modules": "^5.0.0",
    "esbuild": "^0.25.10",
    "eslint": "^9.36.0",
    "husky": "^9.1.7",
    "jest": "^30.1.3",
    "prettier": "^3.6.2",
    "svelte": "^5.39.6",
    "svelte-check": "^4.3.2",
    "ts-jest": "^29.4.4",
    "typescript": "^5.9.2",
    "vite": "^7.1.7",
    "wdio-obsidian-reporter": "^2.1.2",
    "wdio-obsidian-service": "^2.1.2",
    "webdriverio": "^9.19.2"
  },
  "dependencies": {
    "@svar-ui/svelte-gantt": "^2.3.0"
  }
}
```

## 3. Build System Configuration

### vite.config.ts

```typescript
import path from "path";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import builtins from "builtin-modules";
import fs from "fs";

const prod = process.argv[2] === "production";

// Plugin to copy manifest.json to dist
const copyManifest = (): Plugin => ({
  name: "copy-manifest",
  writeBundle() {
    fs.copyFileSync("manifest.json", "dist/manifest.json");
  },
});

export default defineConfig(() => {
  return {
    plugins: [
      svelte({
        compilerOptions: {
          // Enable Svelte 5 runes mode
          runes: true,
        },
      }),
      copyManifest(),
    ],
    watch: !prod,
    build: {
      sourcemap: prod ? false : ("inline" as const),
      minify: prod,
      // Use Vite lib mode https://vitejs.dev/guide/build.html#library-mode
      commonjsOptions: {
        ignoreTryCatch: false,
      },
      lib: {
        entry: path.resolve(__dirname, "./src/main.ts"),
        formats: ["cjs" as const],
      },
      css: {},
      rollupOptions: {
        output: {
          // Overwrite default Vite output fileName
          entryFileNames: "main.js",
          assetFileNames: "styles.css",
        },
        external: [
          "obsidian",
          "electron",
          "codemirror",
          "@codemirror/autocomplete",
          "@codemirror/closebrackets",
          "@codemirror/collab",
          "@codemirror/commands",
          "@codemirror/comment",
          "@codemirror/fold",
          "@codemirror/gutter",
          "@codemirror/highlight",
          "@codemirror/history",
          "@codemirror/language",
          "@codemirror/lint",
          "@codemirror/matchbrackets",
          "@codemirror/panel",
          "@codemirror/rangeset",
          "@codemirror/rectangular-selection",
          "@codemirror/search",
          "@codemirror/state",
          "@codemirror/stream-parser",
          "@codemirror/text",
          "@codemirror/tooltip",
          "@codemirror/view",
          "@lezer/common",
          "@lezer/lr",
          "@lezer/highlight",
          ...builtins,
        ],
      },
      // Use dist as the output dir
      emptyOutDir: true,
      outDir: "dist",
    },
  };
});
```

### svelte.config.js

```javascript
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  // Consult https://svelte.dev/docs#compile-time-svelte-preprocess
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  compilerOptions: {
    // Enable Svelte 5 runes mode
    runes: true,
  },
};
```

## 4. TypeScript Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "lib": ["ES2019", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["svelte"]
  },
  "include": ["src", "**/*.svelte"],
  "exclude": ["node_modules", "dist"]
}
```

## 5. Linting and Code Quality

### eslint.config.mjs

```javascript
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  // Files/folders to ignore
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".wdio-*",
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
        setTimeout: "readonly",
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
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
      },
    },
  },
  {
    files: ["test/**/*.ts"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
  },
];
```

## 6. Testing Infrastructure

### jest.config.mjs

```javascript
/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          target: "es2020",
        },
        module: { type: "commonjs" },
      },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "mjs"],
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
};

export default config;
```

### E2E Testing Configuration (test/wdio/wdio.conf.mts)

> ⚠️ **Cross-platform note:** the `OBSIDIAN_TEST_VAULT` fallbacks shown below hardcode the original author's path (`C:/Users/renato/...`). On any other machine, set `OBSIDIAN_TEST_VAULT` via `.env` — otherwise build/E2E silently target a path that doesn't exist (`npm run build` postbuild fails `EPERM: mkdir 'C:\Users\renato'`). For the full Windows setup chain (antivirus SSL scanning, Node 20 requirement, rollup optional-dep bug, `.env` vault config), see [docs/solutions/developer-experience/windows-build-and-e2e-environment-setup.md](../docs/solutions/developer-experience/windows-build-and-e2e-environment-setup.md).

```typescript
import { type Options } from "@wdio/types";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = process.env.PLUGIN_DIR || path.resolve(__dirname, "../../");
const defaultVault = path.resolve(__dirname, "../../.wdio-vault");
const vaultPath = process.env.OBSIDIAN_TEST_VAULT || defaultVault;

// Ensure vault directory exists to avoid service failures in CI/local
try {
  fs.mkdirSync(vaultPath, { recursive: true });
} catch {
  /* noop */
}

export const config: Options.Testrunner = {
  runner: "local",
  framework: "mocha",
  specs: ["../specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: "latest",
      "wdio:obsidianOptions": {
        plugins: [path.resolve(pluginRoot, "dist")],
        vault: vaultPath,
      },
    },
  ],
  services: ["obsidian"],
  reporters: ["obsidian", "spec"],
  mochaOpts: { ui: "bdd", timeout: 180000 },
};
```

### Sample E2E Test (test/specs/smoke.e2e.ts)

```typescript
import { browser } from "@wdio/globals";

describe("obsidian-gantt smoke", () => {
  it("boots Obsidian (skeleton)", async () => {
    await browser.reloadObsidian?.({
      vault:
        process.env.OBSIDIAN_TEST_VAULT ||
        "C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault",
    });
    // Placeholder until plugin view is implemented
    expect(true).toBe(true);
  });
});
```

## 7. Build Scripts

### scripts/install-to-vault.cjs

```javascript
"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const DEFAULT_VAULT = "C:\\Users\\renato\\obsidian-test-vaults\\obsidian-gantt-test-vault";
const vaultPath = process.env.OBSIDIAN_TEST_VAULT || DEFAULT_VAULT;
const pluginId = "obsidian-gantt";
const pluginDir = path.join(vaultPath, ".obsidian", "plugins", pluginId);

(async () => {
  try {
    await fsp.mkdir(pluginDir, { recursive: true });

    const files = ["manifest.json", "main.js", "styles.css"];
    for (const file of files) {
      const src = path.join("dist", file);
      const dest = path.join(pluginDir, file);
      if (fs.existsSync(src)) {
        await fsp.copyFile(src, dest);
        console.log(`[install] Copied ${src} -> ${dest}`);
      } else {
        console.warn(`[install] Missing ${src}, skipped`);
      }
    }

    // Ensure data.json exists; do not overwrite if present
    const dataPath = path.join(pluginDir, "data.json");
    if (!fs.existsSync(dataPath)) {
      await fsp.writeFile(dataPath, "{}", "utf8");
      console.log(`[install] Created ${dataPath}`);
    } else {
      console.log("[install] data.json already exists; not overwriting");
    }

    console.log(`[install] Installed plugin to ${pluginDir}`);
  } catch (err) {
    console.error("[install] Failed:", err);
    process.exit(1);
  }
})();
```

### scripts/e2e-local.mjs

```javascript
#!/usr/bin/env node
import { spawnSync } from "node:child_process";

// Repo-scoped local test vault path (user-provided)
const LOCAL_VAULT = "C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault";

// Respect existing env if set, otherwise apply local default for this process only
process.env.OBSIDIAN_TEST_VAULT = process.env.OBSIDIAN_TEST_VAULT || LOCAL_VAULT;

console.log(`[local] Using OBSIDIAN_TEST_VAULT=${process.env.OBSIDIAN_TEST_VAULT}`);

// Build and install locally
const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}
const install = spawnSync(process.execPath, ["scripts/install-to-vault.cjs"], {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});
if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

// Run WDIO directly via its bin script using local node_modules path
import path from "node:path";
const wdioBin = path.join(process.cwd(), "node_modules", "@wdio", "cli", "bin", "wdio.js");
const e2e = spawnSync(process.execPath, [wdioBin, "run", "./test/wdio/wdio.conf.mts"], {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});
process.exit(e2e.status ?? 1);
```

### scripts/build.mjs

```javascript
import esbuild from "esbuild";
import fs from "node:fs/promises";

const isWatch = process.argv.includes("--watch");

await fs.mkdir("dist", { recursive: true });

const options = {
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  sourcemap: true,
  target: ["es2018"],
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx", ".css": "text" },
  external: ["obsidian", "electron", "fs", "path", "os"],
};

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[build] Watching...");
} else {
  await esbuild.build(options);
  console.log("[build] Done");
}

// Copy static assets (do not fail build if missing)
for (const file of ["manifest.json", "styles.css"]) {
  try {
    await fs.copyFile(file, `dist/${file}`);
  } catch {
    console.warn(`[build] Optional asset missing: ${file}`);
  }
}
```

## 8. Git Hooks and Pre-commit

### .husky/pre-commit

```bash
npm run lint && npm run typecheck
```

### Setup Husky

```bash
npm install husky --save-dev
npx husky init
echo "npm run lint && npm run typecheck" > .husky/pre-commit
```

## 9. CI/CD Pipeline

### .github/workflows/ci.yml

```yaml
name: CI

on:
  pull_request:

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install dependencies
        run: npm ci
      - name: Lint
        run: npm run lint --if-present
      - name: Typecheck
        run: npm run typecheck --if-present
      - name: Unit tests
        run: npm test --if-present
      - name: Build
        run: npm run build

  e2e:
    runs-on: windows-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install dependencies
        run: npm ci
      - name: Prepare temp vault path
        shell: pwsh
        run: |
          $vault = "$Env:RUNNER_TEMP\\vault"
          echo "OBSIDIAN_TEST_VAULT=$vault" | Out-File -FilePath $Env:GITHUB_ENV -Encoding utf8 -Append
          New-Item -ItemType Directory -Force -Path $vault | Out-Null
      - name: Build plugin
        run: npm run build
      - name: Install plugin into temp vault
        run: node scripts/install-to-vault.cjs
      - name: Run E2E tests (WDIO)
        run: npm run e2e
      - name: Upload E2E artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-artifacts
          path: |
            .wdio-*
            test-results
            **/wdio-*.log
```

## 10. Obsidian Plugin Configuration

### manifest.json

```json
{
  "id": "obsidian-gantt",
  "name": "Obsidian Gantt",
  "version": "0.0.1",
  "minAppVersion": "1.5.0",
  "description": "Generate SVAR Svelte Gantt charts from Obsidian note properties and YAML frontmatter metadata.",
  "author": "Your Name / Open Source Community",
  "authorUrl": "",
  "isDesktopOnly": false
}
```

## 11. Git Configuration

### .gitignore

```gitignore
# Node / package managers
node_modules/
npm-debug.log*
yarn-error.log*
pnpm-debug.log*

# Build outputs / coverage
/dist/
/coverage/
.eslintcache

# Editor / OS
.vscode/
.idea/
.DS_Store
Thumbs.db

# Test & E2E artifacts
.test-results/
.wdio-*

# Env files (if used)
.env
.env.*

project/
.augment/

# Obsidian local config / E2E cache
.obsidian/
test/wdio/.obsidian-cache/
```

## 12. License Configuration

### LICENSE

```text
GNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```

**Note**: GPL v3 license is required for compatibility with SVAR Svelte Gantt library which is also
GPL v3 licensed.

## 13. Setup Instructions

### Prerequisites

- Node.js 18+
- npm or yarn
- Git
- Obsidian (for E2E testing)

### Initial Setup Commands

```bash
# 1. Initialize repository
git init
git add .
git commit -m "feat: initial project setup with complete infrastructure"

# 2. Install dependencies
npm install

# 3. Setup git hooks
npm run prepare

# 4. Create test vault directory (adjust path as needed)
mkdir -p "C:/Users/[username]/obsidian-test-vaults/obsidian-gantt-test-vault"

# 5. Build and test
npm run build
npm run test
npm run lint
npm run typecheck

# 6. Run E2E tests (requires Obsidian installed)
npm run e2e:local
```

### Environment Variables

- `OBSIDIAN_TEST_VAULT`: Path to test vault (defaults to user-specific path)
- `PLUGIN_DIR`: Plugin directory for E2E tests (defaults to project root)

### Development Workflow

1. **Development**: `npm run dev` (watch mode with auto-install)
2. **Testing**: `npm run test` (unit tests)
3. **Linting**: `npm run lint` (ESLint)
4. **Type Checking**: `npm run typecheck` (Svelte check)
5. **E2E Testing**: `npm run e2e:local` (full E2E suite)
6. **Formatting**: `npm run format` (Prettier)

### CI/CD Features

- ✅ **Automated Testing**: Unit tests, linting, type checking
- ✅ **E2E Testing**: WebdriverIO with Obsidian service
- ✅ **Build Verification**: Ensures plugin builds successfully
- ✅ **Artifact Collection**: E2E test results and logs
- ✅ **Pre-commit Hooks**: Lint and typecheck before commits
- ✅ **Cross-platform**: Windows-focused but adaptable

### Key Infrastructure Benefits

1. **Complete Test Coverage**: Unit, integration, and E2E testing
2. **Automated Quality Gates**: Pre-commit hooks and CI checks
3. **Development Efficiency**: Hot reloading and auto-installation
4. **Production Ready**: Optimized builds with proper externals
5. **Obsidian Integration**: Proper plugin structure and testing
6. **Modern Tooling**: Vite, Svelte 5, TypeScript, ESLint 9
7. **Scalable Architecture**: Modular structure for team development
8. **GPL v3 Compliance**: Compatible with SVAR Svelte Gantt licensing

## 14. Customization Notes

### Vault Path Configuration

Update the vault paths in:

- `scripts/install-to-vault.cjs` (DEFAULT_VAULT)
- `scripts/e2e-local.mjs` (LOCAL_VAULT)
- `test/specs/smoke.e2e.ts` (fallback path)

### Plugin ID and Metadata

Update in:

- `manifest.json` (id, name, description, author)
- `package.json` (name, description, author)
- `scripts/install-to-vault.cjs` (pluginId)

### Build Targets

Modify `vite.config.ts` and `tsconfig.json` for different:

- Target environments (ES2019, ES2020, etc.)
- Module systems (ESM, CJS)
- Browser compatibility

### License Compliance

- Ensure all dependencies are GPL v3 compatible
- Include proper license headers in source files
- Maintain GPL v3 license file in repository root

This infrastructure provides a solid foundation for professional Obsidian plugin development with
modern tooling, comprehensive testing capabilities, and proper GPL v3 license compliance for SVAR
Svelte Gantt integration.
