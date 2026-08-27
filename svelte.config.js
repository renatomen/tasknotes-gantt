import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { inlineExternalStyle } from "./scripts/style-src-inline.cjs";

export default {
  // Consult https://svelte.dev/docs#compile-time-svelte-preprocess
  // for more information about preprocessors
  preprocess: [inlineExternalStyle(), vitePreprocess()],

  compilerOptions: {
    // Enable Svelte 5 runes mode for SVAR Svelte components
    runes: true,
  },
};
