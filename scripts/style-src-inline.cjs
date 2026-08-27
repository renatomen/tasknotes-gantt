"use strict";

const { readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

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
        // Function replacer: the CSS must land literally, never as a
        // replacement template ($& and friends would be expanded).
        code: content.replace(match[0], () => `<style>${css}</style>`),
        dependencies: [cssPath],
      };
    },
  };
}

module.exports = { inlineExternalStyle };
