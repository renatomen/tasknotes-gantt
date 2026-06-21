/**
 * Locks down the pure theme resolvers (plan 002 U1). These map the per-view
 * mode + Obsidian dark state to the SVAR theme class and `wx-theme` context
 * value, with no DOM/Obsidian dependency. The DOM detection helpers
 * (isObsidianDark/subscribeObsidianTheme) are exercised by U2's view, not here.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { App } from "obsidian";
import {
  normalizeThemeMode,
  readThemeMode,
  resolveThemeClass,
  resolveThemeContext,
  subscribeObsidianTheme,
} from "../../src/bases/themeResolver";

describe("resolveThemeClass", () => {
  it("follows Obsidian in auto mode (F1/F3)", () => {
    expect(resolveThemeClass("auto", true)).toBe("wx-willow-dark-theme");
    expect(resolveThemeClass("auto", false)).toBe("wx-willow-theme");
  });

  it("overrides Obsidian when mode is light or dark (F2)", () => {
    // light wins even when Obsidian is dark
    expect(resolveThemeClass("light", true)).toBe("wx-willow-theme");
    // dark wins even when Obsidian is light
    expect(resolveThemeClass("dark", false)).toBe("wx-willow-dark-theme");
    // …and the agreeing-state half of the override matrix: the override still
    // wins (independently of Obsidian) when Obsidian already matches it.
    expect(resolveThemeClass("light", false)).toBe("wx-willow-theme");
    expect(resolveThemeClass("dark", true)).toBe("wx-willow-dark-theme");
  });

  it("treats an unknown/missing mode as auto", () => {
    expect(resolveThemeClass("bogus" as never, true)).toBe("wx-willow-dark-theme");
    expect(resolveThemeClass(undefined as never, false)).toBe("wx-willow-theme");
  });
});

describe("resolveThemeContext", () => {
  it("mirrors the class mapping", () => {
    expect(resolveThemeContext("auto", true)).toBe("willow-dark");
    expect(resolveThemeContext("auto", false)).toBe("willow");
    expect(resolveThemeContext("light", true)).toBe("willow");
    expect(resolveThemeContext("dark", false)).toBe("willow-dark");
    // Agreeing-state half of the override matrix (mirrors resolveThemeClass).
    expect(resolveThemeContext("light", false)).toBe("willow");
    expect(resolveThemeContext("dark", true)).toBe("willow-dark");
  });

  it("treats an unknown/missing mode as auto", () => {
    expect(resolveThemeContext("bogus" as never, true)).toBe("willow-dark");
    expect(resolveThemeContext(undefined as never, false)).toBe("willow");
  });
});

describe("normalizeThemeMode", () => {
  it("passes through the known modes", () => {
    expect(normalizeThemeMode("auto")).toBe("auto");
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("dark")).toBe("dark");
  });

  it("coerces anything else to auto", () => {
    expect(normalizeThemeMode("")).toBe("auto");
    expect(normalizeThemeMode(undefined)).toBe("auto");
    expect(normalizeThemeMode(null)).toBe("auto");
    expect(normalizeThemeMode(42)).toBe("auto");
    expect(normalizeThemeMode("Dark")).toBe("auto");
  });
});

describe("readThemeMode", () => {
  it("returns auto when the mode is unset (R4 default)", () => {
    expect(readThemeMode(() => undefined)).toBe("auto");
  });

  it("round-trips the stored mode", () => {
    const store: Record<string, unknown> = { tngantt_themeMode: "dark" };
    expect(readThemeMode((k) => store[k])).toBe("dark");
    store.tngantt_themeMode = "light";
    expect(readThemeMode((k) => store[k])).toBe("light");
  });

  it("normalizes an unexpected stored value to auto", () => {
    expect(readThemeMode(() => "neon")).toBe("auto");
  });
});

describe("subscribeObsidianTheme", () => {
  // The test env is `node` (no jsdom): provide the minimal globals the helper
  // touches — a fake `document.body` and a recording MutationObserver — so the
  // observer-fallback path can be exercised and torn down. Restored after each.
  const realDocument = (globalThis as Record<string, unknown>).document;
  const realObserver = (globalThis as Record<string, unknown>).MutationObserver;

  /** A MutationObserver stand-in recording observe/disconnect calls. */
  class FakeMutationObserver {
    static instances: FakeMutationObserver[] = [];
    observeCount = 0;
    disconnectCount = 0;
    constructor(public readonly callback: () => void) {
      FakeMutationObserver.instances.push(this);
    }
    observe(): void {
      this.observeCount += 1;
    }
    disconnect(): void {
      this.disconnectCount += 1;
    }
  }

  function installDomGlobals(): void {
    (globalThis as Record<string, unknown>).document = { body: {} };
    FakeMutationObserver.instances = [];
    (globalThis as Record<string, unknown>).MutationObserver = FakeMutationObserver;
  }

  afterEach(() => {
    (globalThis as Record<string, unknown>).document = realDocument;
    (globalThis as Record<string, unknown>).MutationObserver = realObserver;
  });

  /** A fake App whose workspace.on succeeds, recording an offref disposer. */
  function fakeAppWithWorkspace(offref: () => void): App {
    const ref = { sentinel: true };
    return {
      workspace: {
        on: jest.fn(() => ref),
        offref: jest.fn((r: unknown) => {
          if (r === ref) offref();
        }),
      },
    } as unknown as App;
  }

  /** A fake App whose workspace.on throws (forces the observer fallback). */
  function fakeAppThatThrows(): App {
    return {
      workspace: {
        on: jest.fn(() => {
          throw new Error("css-change unsupported on this build");
        }),
        offref: jest.fn(),
      },
    } as unknown as App;
  }

  it("returns a working disposer via the observer fallback when workspace.on throws", () => {
    installDomGlobals();
    const onChange = jest.fn();
    const app = fakeAppThatThrows();

    // Must not throw despite workspace.on throwing.
    const dispose = subscribeObsidianTheme(app, onChange);
    expect(typeof dispose).toBe("function");

    // The MutationObserver fallback was registered and observing.
    expect(FakeMutationObserver.instances).toHaveLength(1);
    const observer = FakeMutationObserver.instances[0]!;
    expect(observer.observeCount).toBe(1);

    // A class mutation routes through to onChange.
    observer.callback();
    expect(onChange).toHaveBeenCalledTimes(1);

    // Disposer tears the observer down without throwing.
    expect(() => dispose()).not.toThrow();
    expect(observer.disconnectCount).toBe(1);
  });

  it("disposer tears down BOTH the workspace offref AND observer.disconnect()", () => {
    installDomGlobals();
    const offref = jest.fn();
    const app = fakeAppWithWorkspace(offref);

    const dispose = subscribeObsidianTheme(app, jest.fn());
    expect(FakeMutationObserver.instances).toHaveLength(1);
    const observer = FakeMutationObserver.instances[0]!;

    expect(() => dispose()).not.toThrow();
    // Both teardown paths fired exactly once.
    expect(offref).toHaveBeenCalledTimes(1);
    expect(observer.disconnectCount).toBe(1);
  });

  it("still returns a callable disposer when no DOM/MutationObserver is available", () => {
    // No installDomGlobals(): document/MutationObserver are undefined in node.
    (globalThis as Record<string, unknown>).document = undefined;
    (globalThis as Record<string, unknown>).MutationObserver = undefined;
    const offref = jest.fn();
    const app = fakeAppWithWorkspace(offref);

    const dispose = subscribeObsidianTheme(app, jest.fn());
    expect(typeof dispose).toBe("function");
    // Only the workspace offref path exists; disposing it must not throw.
    expect(() => dispose()).not.toThrow();
    expect(offref).toHaveBeenCalledTimes(1);
  });
});
