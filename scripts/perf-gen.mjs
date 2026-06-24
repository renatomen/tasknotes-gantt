#!/usr/bin/env node
/**
 * On-demand perf-vault generator CLI (U7, #161 perf plan). Wraps U1+U2: emit a
 * production-shaped vault into a scratch dir for manual diagnosis / live repro
 * of the heavy Show-all render (R10/R11 — the "first step" the harness was
 * requested for). Run via `tsx` so it can import the TypeScript generator
 * directly (the `perf:gen` npm script wires this).
 *
 *   npm run perf:gen -- --preset show-all-2660 --out <scratch>
 *   npm run perf:gen -- --tasks 3000 --notes 6000 --matched 70 --seed 1
 *
 * Prints the resulting graph stats + the emitted vault path. Never writes
 * outside the explicit/temp output dir (emitVault's scratch-only guard).
 */
import os from "node:os";
import path from "node:path";
import { generate } from "../test/perf/generator/generate.ts";
import { emitVault } from "../test/perf/generator/emitVault.ts";
import { graphStats } from "../test/perf/generator/graph.ts";
import { paramsForScale } from "../test/perf/generator/presets.ts";

/** CLI preset name → shared calibrated scale point (single source of truth). */
const PRESET_TO_SCALE = {
  small: "small",
  medium: "medium",
  // ~3332 render instances under Show-all — the #161 explosion scale.
  "show-all-2660": "large",
  // The full ~10k/~5k/~261 production shape (heavy diagnosis / scheduled parity).
  "full-10k": "full",
};

/** Minimal `--key value` / `--key=value` parser (no new dependency). */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[arg.slice(2)] = true;
      } else {
        out[arg.slice(2)] = next;
        i += 1;
      }
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const presetName = args.preset ?? "show-all-2660";
  const scalePoint = PRESET_TO_SCALE[presetName];
  if (!scalePoint) {
    console.error(
      `Unknown preset "${presetName}". Available: ${Object.keys(PRESET_TO_SCALE).join(", ")}`,
    );
    process.exit(1);
  }

  const overrides = {};
  if (args.seed !== undefined) overrides.seed = Number(args.seed);
  if (args.tasks !== undefined) overrides.taskCount = Number(args.tasks);
  if (args.notes !== undefined) overrides.totalNotes = Number(args.notes);
  if (args.matched !== undefined) overrides.matchedCount = Number(args.matched);
  const params = paramsForScale(scalePoint, overrides);

  const outDir =
    typeof args.out === "string" && args.out !== ""
      ? path.resolve(args.out)
      : path.join(os.tmpdir(), `og-perf-vault-${presetName}`);

  const graph = generate(params);
  const stats = graphStats(graph);

  return emitVault(graph, { outDir }).then((result) => {
    console.log(`\nPerf vault generated (preset: ${presetName})`);
    console.log(`  path:            ${result.vaultDir}`);
    console.log(`  base:            ${result.basePath}`);
    console.log(`  notes written:   ${result.notesWritten}`);
    console.log(`  tasks:           ${stats.taskCount}`);
    console.log(`  matched:         ${stats.matchedCount}`);
    console.log(`  max depth:       ${stats.maxDepth}`);
    console.log(`  boundary-cross:  ${(stats.boundaryCrossingFraction * 100).toFixed(1)}%`);
    console.log(`  dependency edges:${stats.dependencyCount}`);
    console.log(`  multi-parent:    ${JSON.stringify(stats.multiParentHistogram)}`);
    console.log(`\nOpen this folder as an Obsidian vault to reproduce the heavy Show-all render.\n`);
  });
}

main();
