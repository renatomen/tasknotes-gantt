/**
 * Locks down the pure theme resolver (plan 002 U1). `isEffectiveDark` maps the
 * per-view mode + Obsidian dark state to a boolean that chooses SVAR's real
 * <Willow> / <WillowDark> theme component in the view, with no DOM/Obsidian
 * dependency. The DOM detection helpers (isObsidianDark/subscribeObsidianTheme)
 * are exercised by U2's view, not here.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { App } from "obsidian";
import {
  isEffectiveDark,
  normalizeThemeMode,
  readThemeMode,
  subscribeObsidianTheme,
} from "../../src/bases/themeResolver";

describe("isEffectiveDark", () => {
  it("follows Obsidian in auto mode (F1/F3)", () => {
    expect(isEffectiveDark("auto", true)).toBe(true);
    expect(isEffectiveDark("auto", false)).toBe(false);
  });

  it("overrides Obsidian when mode is light or dark (F2)", () => {
    // light wins even when Obsidian is dark
    expect(isEffectiveDark("light", true)).toBe(false);
    // dark wins even when Obsidian is light
    expect(isEffectiveDark("dark", false)).toBe(true);
    // …and the agreeing-state half of the override matrix: the override still
    // wins (independently of Obsidian) when Obsidian already matches it.
    expect(isEffectiveDark("light", false)).toBe(false);
    expect(isEffectiveDark("dark", true)).toBe(true);
  });

  it("treats an unknown/missing mode as auto", () => {
    expect(isEffectiveDark("bogus" as never, true)).toBe(true);
    expect(isEffectiveDark(undefined as never, false)).toBe(false);
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
