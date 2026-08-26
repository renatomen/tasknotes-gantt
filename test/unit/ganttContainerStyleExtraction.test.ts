import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const componentPath = join(process.cwd(), "src", "bases", "GanttContainer.svelte");
const stylesheetPath = join(process.cwd(), "src", "bases", "GanttContainer.css");
const svelteConfigPath = join(process.cwd(), "svelte.config.js");

describe("GanttContainer style extraction guard", () => {
  it("keeps the component's styles external via a single empty style-src tag", () => {
    const component = readFileSync(componentPath, "utf8");
    const styleTagCount = component.match(/<style/g) ?? [];
    expect(styleTagCount).toHaveLength(1);
    expect(component).toContain('<style src="./GanttContainer.css"></style>');
  });

  it("keeps the extracted stylesheet present with its load-bearing concerns", () => {
    expect(existsSync(stylesheetPath)).toBe(true);
    const stylesheet = readFileSync(stylesheetPath, "utf8");
    expect(stylesheet).toContain(".og-bases-gantt");
    expect(stylesheet).toContain("mask-image");
    expect(stylesheet).toContain("--og-zigzag-depth");
  });

  it("keeps the style-inline preprocessor wired so the external styles reach the compiler", () => {
    const svelteConfig = readFileSync(svelteConfigPath, "utf8");
    expect(svelteConfig).toContain('name: "og-style-src-inline"');
    expect(svelteConfig).toContain("preprocess: [inlineExternalStyle(), vitePreprocess()]");
  });
});
