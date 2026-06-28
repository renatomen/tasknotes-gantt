import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import builtins from "builtin-modules";
import fs from "fs";
import { installToVault } from "./scripts/install-to-vault.mjs";
import { generate as generateReleaseNotes } from "./scripts/generate-release-notes-import.mjs";

const prod = process.argv[2] === "production";

// Plugin to copy manifest.json to dist
const copyManifest = (): Plugin => ({
  name: "copy-manifest",
  writeBundle() {
    fs.copyFileSync("manifest.json", "dist/manifest.json");
  },
});

// Regenerate the in-app "What's New" bundle (src/releaseNotes.ts) before Rollup
// resolves src/main.ts — it is a compile-time INPUT, so this must run at
// buildStart, not writeBundle/closeBundle. Write-if-different keeps watch builds
// from dirtying the tree. See scripts/generate-release-notes-import.mjs.
const generateReleaseNotesPlugin = (): Plugin => ({
  name: "generate-release-notes",
  buildStart() {
    generateReleaseNotes();
  },
});

// Optional, opt-in install of the built plugin into a developer's local Obsidian
// vault for manual checking. Lives in the build (closeBundle) so every build path
// behaves identically; a no-op unless OBSIDIAN_TEST_VAULT points at an existing
// vault, and it never fails the build. See scripts/install-to-vault.mjs.
const installToVaultPlugin = (vault: string | undefined): Plugin => ({
  name: "install-to-vault",
  closeBundle() {
    installToVault({ vault });
  },
});

export default defineConfig(({ mode }) => {
  // Resolve the optional vault: an inline shell var wins (so E2E can target a
  // disposable copy), falling back to a gitignored .env. No hardcoded default.
  const env = loadEnv(mode, process.cwd(), "");
  const vault = process.env.OBSIDIAN_TEST_VAULT || env.OBSIDIAN_TEST_VAULT;
  return {
    plugins: [
      svelte({
        compilerOptions: {
          // Enable Svelte 5 runes mode (SVAR components are authored for Svelte 5)
          runes: true,
        },
      }),
      generateReleaseNotesPlugin(),
      copyManifest(),
      installToVaultPlugin(vault),
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
