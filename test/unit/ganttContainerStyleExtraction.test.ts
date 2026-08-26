import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const componentPath = join(process.cwd(), "src", "bases", "GanttContainer.svelte");
const stylesheetPath = join(process.cwd(), "src", "bases", "GanttContainer.css");
const svelteConfigPath = join(process.cwd(), "svelte.config.js");
const preprocessorModulePath = join(process.cwd(), "scripts", "style-src-inline.cjs");

interface StyleInlinePreprocessor {
  name: string;
  markup(input: { content: string; filename?: string }): { code: string; dependencies: string[] } | undefined;
}

const loadCjs = createRequire(join(process.cwd(), "package.json"));
const loadPreprocessor = (): StyleInlinePreprocessor => {
  const { inlineExternalStyle } = loadCjs(preprocessorModulePath) as {
    inlineExternalStyle: () => StyleInlinePreprocessor;
  };
  return inlineExternalStyle();
};

describe("GanttContainer style extraction guard", () => {
  it("keeps the component's styles external via a single empty style-src tag", () => {
    const component = readFileSync(componentPath, "utf8");
    const styleTagCount = component.match(/<style/g) ?? [];
    expect(styleTagCount).toHaveLength(1);
    expect(component).toContain('<style src="./GanttContainer.css"></style>');
  });

  it("keeps the extracted stylesheet present with its load-bearing concerns", () => {
    expect(existsSync(stylesheetPath)).toBe(true);
    // Sentinels must match active rules, not explanatory CSS comments.
    const activeCss = readFileSync(stylesheetPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(activeCss).toContain(".og-bases-gantt");
    expect(activeCss).toContain("mask-image");
    expect(activeCss).toContain(".wxi-menu-right");
    expect(activeCss).toContain("--og-zigzag-depth");
  });

  it("keeps the style-inline preprocessor wired so the external styles reach the compiler", () => {
    const svelteConfig = readFileSync(svelteConfigPath, "utf8");
    expect(svelteConfig).toContain('import { inlineExternalStyle } from "./scripts/style-src-inline.cjs"');
    expect(svelteConfig).toContain("preprocess: [inlineExternalStyle(), vitePreprocess()]");
    expect(loadPreprocessor().name).toBe("og-style-src-inline");
  });
});

describe("style-inline preprocessor execution", () => {
  it("inlines the real stylesheet bytes when fed the real component source", () => {
    const preprocessor = loadPreprocessor();
    const component = readFileSync(componentPath, "utf8");
    const stylesheet = readFileSync(stylesheetPath, "utf8");
    const result = preprocessor.markup({ content: component, filename: componentPath });
    expect(result).toBeDefined();
    expect(result!.code).toBe(
      component.replace('<style src="./GanttContainer.css"></style>', `<style>${stylesheet}</style>`),
    );
    expect(result!.code).toContain(".og-bases-gantt");
    expect(result!.code).toContain(".wxi-menu-right");
    // A comment-wrapped style tag would still inline but ship no styles, and
    // a CSS comment could carry the sentinel text: strip both comment kinds.
    const withoutComments = result!.code
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).toContain("<style>");
    expect(withoutComments).toContain(".wxi-menu-right");
    expect(result!.dependencies).toEqual([resolve(join(process.cwd(), "src", "bases"), "./GanttContainer.css")]);
  });

  it("preserves CSS bytes verbatim, including String.replace metacharacters", () => {
    const preprocessor = loadPreprocessor();
    const fixtureDir = mkdtempSync(join(tmpdir(), "og-style-inline-"));
    try {
      const fixtureCss = '\n  .a::before { content: "$& and $$ and $1"; }\n';
      writeFileSync(join(fixtureDir, "fixture.css"), fixtureCss);
      const result = preprocessor.markup({
        content: '<div></div>\n<style src="./fixture.css"></style>',
        filename: join(fixtureDir, "Fake.svelte"),
      });
      expect(result).toBeDefined();
      expect(result!.code).toBe(`<div></div>\n<style>${fixtureCss}</style>`);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("leaves components without a style-src tag untouched", () => {
    const preprocessor = loadPreprocessor();
    const result = preprocessor.markup({
      content: "<div></div>\n<style>.x { color: red; }</style>",
      filename: componentPath,
    });
    expect(result).toBeUndefined();
  });

  it("the effective svelte.config.js export inlines the real component's styles", () => {
    // Jest's VM cannot import the ESM config, so a real node subprocess
    // executes the config's OWN preprocess array — a commented-out wiring
    // line cannot pass this, unlike source-text assertions.
    const script = [
      `const configUrl = ${JSON.stringify(pathToFileURL(svelteConfigPath).href)};`,
      `const componentPath = ${JSON.stringify(componentPath)};`,
      'const { readFileSync } = await import("node:fs");',
      "const config = (await import(configUrl)).default;",
      "const preprocessors = Array.isArray(config.preprocess) ? config.preprocess : [config.preprocess];",
      'const pre = preprocessors.find((p) => p && p.name === "og-style-src-inline");',
      'if (!pre) { console.log("NO_PREPROCESSOR_IN_EFFECTIVE_CONFIG"); }',
      "else {",
      '  const component = readFileSync(componentPath, "utf8");',
      "  const result = pre.markup({ content: component, filename: componentPath });",
      '  const active = result ? result.code.replace(/<!--[\\s\\S]*?-->/g, "") : "";',
      "  console.log(",
      '    result && active.includes(".wxi-menu-right") && !result.code.includes(\'src="./GanttContainer.css"\')',
      '      ? "EFFECTIVE_CONFIG_INLINES"',
      '      : "BAD_OUTPUT",',
      "  );",
      "}",
    ].join("\n");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      cwd: process.cwd(),
    }).trim();
    expect(out).toBe("EFFECTIVE_CONFIG_INLINES");
  });
});
