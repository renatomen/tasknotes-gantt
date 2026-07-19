/**
 * Shared parent-link resolver (single source of truth, previously duplicated
 * across the Bases property-mapping and view layers).
 */
import { describe, it, expect } from "@jest/globals";
import type { App } from "obsidian";
import { resolveParentLink } from "../../src/bases/parentLink";

/** App whose metadata cache echoes the link path back as the resolved file. */
function echoApp(): App {
  return {
    metadataCache: { getFirstLinkpathDest: (linkpath: string) => ({ path: linkpath }) },
    vault: { getAbstractFileByPath: () => null },
  } as unknown as App;
}

/** App whose metadata cache always misses; vault resolves per the callback. */
function vaultApp(vaultHit: boolean): App {
  return {
    metadataCache: { getFirstLinkpathDest: () => null },
    vault: { getAbstractFileByPath: (p: string) => (vaultHit ? { path: p } : null) },
  } as unknown as App;
}

describe("resolveParentLink", () => {
  it("resolves a [[Page]] wikilink", () => {
    expect(resolveParentLink(echoApp(), "[[Parent Page]]", "src.md")).toBe("Parent Page");
  });

  it("strips the alias from a [[Page|Alias]] wikilink", () => {
    expect(resolveParentLink(echoApp(), "[[Parent Page|Shown]]", "src.md")).toBe("Parent Page");
  });

  it("extracts the path from a [text](path) markdown link", () => {
    expect(resolveParentLink(echoApp(), "[Parent](projects/p.md)", "src.md")).toBe("projects/p.md");
  });

  it("resolves a plain path via the metadata cache", () => {
    expect(resolveParentLink(echoApp(), "projects/p.md", "src.md")).toBe("projects/p.md");
  });

  it("falls back to a direct vault path when the metadata cache misses", () => {
    expect(resolveParentLink(vaultApp(true), "projects/direct.md", "src.md")).toBe("projects/direct.md");
  });

  it("returns null when neither the cache nor the vault resolves it", () => {
    expect(resolveParentLink(vaultApp(false), "[[Missing]]", "src.md")).toBeNull();
  });

  it("returns null for an empty parent reference", () => {
    expect(resolveParentLink(echoApp(), "", "src.md")).toBeNull();
  });

  it("returns null when there is no source path", () => {
    expect(resolveParentLink(echoApp(), "[[Parent]]", undefined)).toBeNull();
  });

  it("resolves vault-wide with an empty source path (no anchoring file)", () => {
    expect(resolveParentLink(echoApp(), "[[Parent Page]]", "")).toBe("Parent Page");
  });
});
