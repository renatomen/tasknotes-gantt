/**
 * Guard: the plugin's own per-view config keys must always be read/written
 * through their `tngantt_` prefix.
 *
 * Background: PR #104 renamed every plugin Base-view config key to a
 * `tngantt_` prefix, but a second reader (in the since-removed TaskList view)
 * silently read the bare keys the options UI no longer writes (PR #108). See
 * docs/solutions/integration-issues/tasklist-view-tngantt-config-keys.md.
 *
 * This test mechanically asserts no bare (unprefixed) plugin-key read/write
 * remains anywhere in src/, so the whole class of bug can't reappear via a
 * future rename that misses a call site.
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** The plugin-custom view-config keys (without the `tngantt_` prefix). */
const PLUGIN_CONFIG_KEYS = [
  "textProperty",
  "startDateProperty",
  "endDateProperty",
  "progressProperty",
  "parentProperty",
  "statusProperty",
  "defaultScale",
  "dependencyArrowMode",
  "parentDateCascade",
  "defaultDuration",
  "showUndatedTasks",
  "showPartialDateTasks",
  "showDateIndicators",
  "tableWidth",
];

/**
 * Matches a `get(...)`/`set(...)` call whose first argument is one of the
 * plugin keys as a bare quoted string. Covers both `this.config.get('key')`
 * and the standalone `get('key')` callback style (datePolicyConfig). The
 * quote immediately before the key means the prefixed form
 * (`'tngantt_parentProperty'`) does NOT match — `_` precedes the key there,
 * not a quote. `\b` keeps `reset(`/`offset(` from matching `set(`.
 */
const BARE_CONFIG_KEY = new RegExp(
  String.raw`\b(?:get|set)\(\s*['"](?:` +
    PLUGIN_CONFIG_KEYS.join("|") +
    String.raw`)['"]`,
);

const SRC_DIR = resolve(process.cwd(), "src");

/** Recursively collect .ts/.tsx/.svelte source files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|svelte)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("plugin config keys stay tngantt_-prefixed", () => {
  // Positive control: prove the matcher actually catches a violation and
  // ignores the legitimate forms, so a regex typo can't make this guard
  // silently pass forever.
  it("matcher catches bare reads and ignores prefixed / non-plugin keys", () => {
    expect(BARE_CONFIG_KEY.test("this.config.get('parentProperty')")).toBe(true);
    expect(BARE_CONFIG_KEY.test("get('defaultDuration')")).toBe(true);
    expect(BARE_CONFIG_KEY.test('this.config.set("tableWidth", 400)')).toBe(true);
    expect(BARE_CONFIG_KEY.test("config?.get('tngantt_parentProperty')")).toBe(false);
    expect(BARE_CONFIG_KEY.test("this.config.get('columnSize')")).toBe(false);
    expect(BARE_CONFIG_KEY.test("this.offset('parentProperty')")).toBe(false);
  });

  it("has no bare (unprefixed) plugin-key get/set in src/", () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (BARE_CONFIG_KEY.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
