import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const EXTERNAL_STYLE_TAG = /<style src="(\.\/[^"]+\.css)"><\/style>/;

// Inlines the referenced CSS file's bytes verbatim, so the compiled scoped CSS
// (content-derived hash included) is byte-identical to an in-file style block.
function inlineExternalStyle() {
  return {
    name: "og-style-src-inline",
    markup({ content, filename }) {
      if (!filename) return undefined;
      const match = EXTERNAL_STYLE_TAG.exec(content);
      if (!match) return undefined;
      const cssPath = resolve(dirname(filename), match[1]);
      const css = readFileSync(cssPath, "utf8");
      return {
        code: content.replace(match[0], `<style>${css}</style>`),
        dependencies: [cssPath],
      };
    },
  };
}

export default {
  // Consult https://svelte.dev/docs#compile-time-svelte-preprocess
  // for more information about preprocessors
  preprocess: [inlineExternalStyle(), vitePreprocess()],

  compilerOptions: {
    // Enable Svelte 5 runes mode for SVAR Svelte components
    runes: true,
  },
};
