/**
 * Size ratchet: the legacy god-files may only shrink. Their line counts are
 * pinned here as checked-in baselines; a change that grows a file past its
 * baseline fails, and a shrinking PR updates the baseline DOWNWARD to lock the
 * gain in. The per-file cognitive-complexity ceilings in eslint.config.mjs are
 * guarded the same way — a ceiling may only decrease, and no new per-file
 * ceiling entry may appear.
 *
 * Run by ci.yml (build job). Runnable directly: `node scripts/check-size-ratchet.mjs`.
 *
 * @module scripts/check-size-ratchet
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Maximum line count per ratcheted file. Update DOWNWARD only, to the new count. */
export const LINE_BASELINES = {
  "src/bases/GanttContainer.svelte": 3660,
  "src/bases/register.ts": 1463,
};

/**
 * The per-file cognitive-complexity ceilings recorded when the lint gate was
 * armed, keyed by the eslint-config entry's sorted `files` list. Update
 * DOWNWARD only; never add an entry.
 */
export const CEILING_BASELINES = {
  "**/*.{ts,tsx,mts}": 15,
  "**/*.svelte": 15,
  "test/__mocks__/obsidian.ts": 23,
  "test/probe/_diag.probe.ts": 21,
  "test/specs/gantt-resultset-loop.e2e.ts": 17,
  "test/specs/gantt-perf-fullstack.perf.e2e.ts|test/specs/gantt-resultset-storm.perf.e2e.ts": 16,
};

/**
 * Line count in `wc -l` terms (a trailing newline does not start a new line).
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

/**
 * Check every ratcheted file against its baseline.
 * @param {Record<string, number>} baselines
 * @param {(path: string) => string} readFile
 * @returns {{violations: string[], improvements: string[]}}
 */
export function checkLineBaselines(baselines, readFile) {
  const violations = [];
  const improvements = [];
  for (const [file, baseline] of Object.entries(baselines)) {
    const count = countLines(readFile(file));
    if (count > baseline) {
      violations.push(
        `${file}: ${count} lines exceeds the ratchet baseline of ${baseline} — this file may only shrink.`,
      );
    } else if (count < baseline) {
      improvements.push(
        `${file}: ${count} lines is below the baseline of ${baseline} — lock it in by lowering the baseline to ${count}.`,
      );
    }
  }
  return { violations, improvements };
}

/**
 * Extract every cognitive-complexity ceiling from a flat eslint config array,
 * keyed by the entry's sorted `files` list.
 * @param {Array<{files?: string[], rules?: Record<string, unknown>}>} config
 * @returns {Record<string, number>}
 */
export function extractComplexityCeilings(config) {
  const ceilings = {};
  for (const entry of config) {
    const rule = entry?.rules?.["sonarjs/cognitive-complexity"];
    if (!Array.isArray(rule) || typeof rule[1] !== "number") continue;
    const key = [...(entry.files ?? ["<global>"])].sort((a, b) => a.localeCompare(b)).join("|");
    ceilings[key] = Math.max(ceilings[key] ?? 0, rule[1]);
  }
  return ceilings;
}

/**
 * Complexity ceilings are downward-only: a raised value or a NEW per-file
 * ceiling entry is a violation.
 * @param {Record<string, number>} ceilings
 * @param {Record<string, number>} baselines
 * @returns {string[]}
 */
export function checkCeilingBaselines(ceilings, baselines) {
  const violations = [];
  for (const [key, value] of Object.entries(ceilings)) {
    const baseline = baselines[key];
    if (baseline === undefined) {
      violations.push(
        `eslint.config.mjs: new cognitive-complexity ceiling for [${key}] — the exemption list may only shrink.`,
      );
    } else if (value > baseline) {
      violations.push(
        `eslint.config.mjs: cognitive-complexity ceiling for [${key}] rose to ${value} (baseline ${baseline}) — ceilings may only decrease.`,
      );
    }
  }
  return violations;
}

/**
 * Run both ratchets against the working tree.
 * @param {{log?: Pick<Console, "log" | "error">}} [opts]
 * @returns {Promise<string[]>} violations (empty = clean)
 */
export async function checkSizeRatchet({ log = console } = {}) {
  const { violations, improvements } = checkLineBaselines(LINE_BASELINES, (file) =>
    fs.readFileSync(file, "utf8"),
  );
  const config = (await import(pathToFileURL("eslint.config.mjs").href)).default;
  violations.push(...checkCeilingBaselines(extractComplexityCeilings(config), CEILING_BASELINES));
  for (const improvement of improvements) log.log?.(improvement);
  if (violations.length) {
    for (const violation of violations) log.error?.(violation);
  } else {
    log.log?.("size ratchet OK: ratcheted files at or below their baselines, ceilings unchanged.");
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void checkSizeRatchet().then((violations) => {
    if (violations.length) process.exit(1);
  });
}
