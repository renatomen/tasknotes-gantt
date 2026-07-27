/**
 * Size ratchet: the legacy god-files may only shrink. Their line counts are
 * pinned here as checked-in baselines; a change that grows a file past its
 * baseline fails, and a shrinking change FAILS TOO until it lowers the baseline
 * to the new count — the lock is how the ratchet advances, so a stale baseline
 * can never let a later change regrow the file back up to it. The per-file
 * cognitive-complexity ceilings in eslint.config.mjs are guarded with the SAME
 * one-way lock: a raised ceiling or a new per-file entry fails, a LOWERED
 * ceiling fails until its baseline is lowered to match, and a REMOVED
 * exemption fails until its baseline entry is deleted — so the baseline table
 * always mirrors the config exactly and stale headroom can never be re-spent.
 *
 * Run by ci.yml (build job). Runnable directly: `node scripts/check-size-ratchet.mjs`.
 *
 * @module scripts/check-size-ratchet
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Maximum line count per ratcheted file. Update DOWNWARD only, to the new count. */
export const LINE_BASELINES = {
  "src/bases/GanttContainer.svelte": 3659,
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
 * Check every ratcheted file against its baseline. One-way lock: a count above
 * the baseline is a violation, and a count BELOW it is a violation too — the
 * author must lower LINE_BASELINES to the new count, so the shrink can never be
 * silently regrown by a later change riding the stale headroom.
 * @param {Record<string, number>} baselines
 * @param {(path: string) => string} readFile
 * @returns {string[]} violations (empty = clean)
 */
export function checkLineBaselines(baselines, readFile) {
  const violations = [];
  for (const [file, baseline] of Object.entries(baselines)) {
    const count = countLines(readFile(file));
    if (count > baseline) {
      violations.push(
        `${file}: ${count} lines exceeds the ratchet baseline of ${baseline} — this file may only shrink.`,
      );
    } else if (count < baseline) {
      violations.push(
        `${file}: ${count} lines is below the baseline of ${baseline} — lock the gain in by lowering LINE_BASELINES in scripts/check-size-ratchet.mjs to ${count}.`,
      );
    }
  }
  return violations;
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
 * Complexity ceilings ratchet exactly like line counts. A raised value or a
 * NEW per-file ceiling entry is a violation; a ceiling BELOW its baseline is a
 * violation too until the baseline is lowered to match (else the gain could be
 * silently regrown inside the stale headroom); and a baseline entry whose
 * exemption is gone from the config is a violation until the entry is removed
 * (else the exemption could be silently re-added at its old ceiling).
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
    } else if (value < baseline) {
      violations.push(
        `eslint.config.mjs: cognitive-complexity ceiling for [${key}] is ${value}, below the baseline of ${baseline} — lock the gain in by lowering CEILING_BASELINES in scripts/check-size-ratchet.mjs to ${value}.`,
      );
    }
  }
  for (const key of Object.keys(baselines)) {
    if (ceilings[key] === undefined) {
      violations.push(
        `eslint.config.mjs no longer has a cognitive-complexity ceiling for [${key}] — lock the removal in by deleting its CEILING_BASELINES entry in scripts/check-size-ratchet.mjs.`,
      );
    }
  }
  return violations;
}

/**
 * Pull a named baseline table (`export const NAME = {...};`) out of another
 * revision's copy of this script. Entries are `"key": integer` pairs by
 * construction; anything unrecognized is simply not an entry. Null when the
 * table itself is missing.
 * @param {string} source
 * @param {string} name
 * @returns {Record<string, number> | null}
 */
export function extractBaselineTable(source, name) {
  const match = new RegExp(String.raw`export const ${name} = \{([\s\S]*?)\};`).exec(source);
  if (!match) return null;
  const table = {};
  for (const entry of match[1].matchAll(/"([^"]+)":\s*(\d+)/g)) {
    table[entry[1]] = Number(entry[2]);
  }
  return table;
}

/**
 * Compare the working tree's baseline tables against the TARGET branch's copy
 * of this script: a value may only stay or decrease, and a LINE_BASELINES
 * entry present on the base may not disappear — otherwise a PR could regrow a
 * file simply by raising (or deleting) its baseline and pass the working-tree
 * check. A NEW entry (a newly ratcheted file) is allowed. A CEILING_BASELINES
 * entry MAY disappear: the working-tree check demands exactly that when its
 * exemption leaves eslint.config.mjs, and fails a deletion whose exemption
 * remains (the config would then carry a "new" un-baselined ceiling).
 * @param {string} baseSource  the base ref's check-size-ratchet.mjs source text
 * @param {{lines?: Record<string, number>, ceilings?: Record<string, number>}} [current]
 *   working-tree tables (injectable for tests; defaults to the real ones)
 * @returns {string[]} violations (empty = clean)
 */
export function compareAgainstBase(baseSource, current = {}) {
  const tables = {
    LINE_BASELINES: current.lines ?? LINE_BASELINES,
    CEILING_BASELINES: current.ceilings ?? CEILING_BASELINES,
  };
  const violations = [];
  for (const [name, table] of Object.entries(tables)) {
    const base = extractBaselineTable(baseSource, name);
    if (!base) {
      violations.push(`${name}: table not found in the base ref's script — refusing to compare.`);
      continue;
    }
    for (const [key, baseValue] of Object.entries(base)) {
      const value = table[key];
      if (value === undefined) {
        if (name === "LINE_BASELINES") {
          violations.push(
            `${name}: the entry for [${key}] was removed — ratcheted entries may only be lowered, never dropped.`,
          );
        }
      } else if (value > baseValue) {
        violations.push(
          `${name}: [${key}] rose from ${baseValue} to ${value} — baselines may only decrease.`,
        );
      }
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
  const violations = checkLineBaselines(LINE_BASELINES, (file) => fs.readFileSync(file, "utf8"));
  const config = (await import(pathToFileURL("eslint.config.mjs").href)).default;
  violations.push(...checkCeilingBaselines(extractComplexityCeilings(config), CEILING_BASELINES));
  if (violations.length) {
    for (const violation of violations) log.error?.(violation);
  } else {
    log.log?.("size ratchet OK: ratcheted files exactly at their baselines, ceilings unchanged.");
  }
  return violations;
}

/** CLI: default runs the working-tree ratchet; `--against-base <file>` compares
 *  the baselines against the given base-ref copy of this script (CI's PR gate). */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseArg = process.argv.indexOf("--against-base");
  if (baseArg !== -1) {
    const violations = compareAgainstBase(fs.readFileSync(process.argv[baseArg + 1], "utf8"));
    for (const violation of violations) console.error(violation);
    if (violations.length) process.exit(1);
    console.log("baseline ratchet OK: no baseline rose and none was removed vs the base ref.");
  } else {
    void checkSizeRatchet().then((violations) => {
      if (violations.length) process.exit(1);
    });
  }
}
