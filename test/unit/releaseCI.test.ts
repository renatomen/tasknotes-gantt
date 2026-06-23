import { isPrerelease, applyVersionBump } from "../../version-bump.mjs";
import { maskNotesContent, findForbidden } from "../../scripts/check-bundle-hygiene.mjs";

describe("version-bump: prerelease guard (KTD5)", () => {
  it("classifies prerelease vs stable", () => {
    expect(isPrerelease("1.2.0")).toBe(false);
    expect(isPrerelease("1.2.0-beta.1")).toBe(true);
  });

  it("stable bump writes a versions.json entry", () => {
    const out = applyVersionBump({
      targetVersion: "1.2.0",
      manifest: { version: "1.1.0", minAppVersion: "1.10.0" },
      versions: { "1.1.0": "1.10.0" },
    });
    expect(out.manifest.version).toBe("1.2.0");
    expect(out.versions["1.2.0"]).toBe("1.10.0");
    expect(out.wroteVersionsEntry).toBe(true);
  });

  it("prerelease bump updates manifest only, never versions.json", () => {
    const out = applyVersionBump({
      targetVersion: "1.2.0-beta.1",
      manifest: { version: "1.1.0", minAppVersion: "1.10.0" },
      versions: { "1.1.0": "1.10.0" },
    });
    expect(out.manifest.version).toBe("1.2.0-beta.1"); // BRAT needs the full beta version
    expect(out.versions["1.2.0-beta.1"]).toBeUndefined(); // store map stays clean
    expect(out.wroteVersionsEntry).toBe(false);
  });
});

describe("bundle hygiene: call-site-aware masking (KTD9)", () => {
  it("flags a forbidden call in executable code", () => {
    expect(findForbidden('const r = fetch(url); eval(x);', [])).toEqual(expect.arrayContaining(["fetch(", "eval("]));
  });

  it("ignores forbidden tokens that appear only inside inlined notes prose", () => {
    const notes = { content: "# 1.0.0\n\n- Fixed the fetch() retry and removed an eval() path\n" };
    // Bundle inlines the notes as an (escaped) string literal — same prose, escaped newlines.
    const escaped = JSON.stringify(notes.content);
    const bundle = `var releaseNotes = [{content: ${escaped}}]; var clean = 1;`;
    expect(findForbidden(bundle, [notes])).toEqual([]);
  });

  it("still catches a real call alongside benign notes prose", () => {
    const notes = { content: "Fixed the fetch() retry\n" };
    const escaped = JSON.stringify(notes.content);
    const bundle = `var n = ${escaped}; var bad = new WebSocket("x");`;
    expect(findForbidden(bundle, [notes])).toEqual(["new WebSocket"]);
  });

  it("masking removes both escaped and raw forms of notes content", () => {
    const notes = { content: "uses fetch( here" };
    // raw form present in the bundle text
    expect(maskNotesContent("a uses fetch( here b", [notes])).not.toContain("fetch(");
    // escaped (string-literal) form present in the bundle text
    expect(maskNotesContent(`x ${JSON.stringify(notes.content)} y`, [notes])).not.toContain("fetch(");
  });
});
