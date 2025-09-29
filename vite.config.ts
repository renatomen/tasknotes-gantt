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
          // Enable Svelte 5 runes mode (SVAR components are authored for Svelte 5)
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
