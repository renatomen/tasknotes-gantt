import { expect } from "@wdio/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { captureDemo } from "../captureDemo.mjs";

/**
 * Demo-capture entry spec (visual-assets convention, U4). A `browser` session
 * only exists inside a WDIO runner, so the reusable staging logic in
 * `captureDemo.mjs` is invoked from here. Defaults capture the maximized Gantt
 * against the `gantt-viewport` fixture; override per feature via env vars:
 *
 *   CAPTURE_FIXTURE  fixture vault dir under test/vaults/   (default: gantt-viewport)
 *   CAPTURE_BASE     .base file within the vault            (default: Roadmap.base)
 *   CAPTURE_SLUG     feature slug for docs/media/<slug>     (default: gantt-demo)
 *   CAPTURE_THEMES   comma list of dark,light               (default: none → current theme)
 *   CAPTURE_EXT      image extension                        (default: png)
 *
 * This is capture scaffolding, not a functional test — it runs only via
 * `npm run capture:demo` (wdio.capture.conf.mts), never in the per-PR e2e suite.
 */

const themes = (process.env.CAPTURE_THEMES ?? "")
  .split(",")
  .map((t) => t.trim())
  .filter((t) => t === "dark" || t === "light") as Array<"dark" | "light">;

describe("demo capture", () => {
  it("writes a non-empty screenshot into docs/media/", async () => {
    const written = await captureDemo({
      fixture: process.env.CAPTURE_FIXTURE ?? "gantt-viewport",
      base: process.env.CAPTURE_BASE ?? "Roadmap.base",
      slug: process.env.CAPTURE_SLUG ?? "gantt-demo",
      themes,
      ext: process.env.CAPTURE_EXT ?? "png",
    });

    expect(written.length).toBeGreaterThan(0);
    for (const rel of written) {
      const abs = path.resolve(process.cwd(), rel);
      expect(fs.existsSync(abs)).toBe(true);
      expect(fs.statSync(abs).size).toBeGreaterThan(0);
    }
  });
});
