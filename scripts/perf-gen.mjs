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

/** Named presets — the calibrated points the isolated gate (U4) measures. */
const PRESETS = {
  small: { totalNotes: 3000, taskCount: 1500, matchedCount: 12 },
  medium: { totalNotes: 6000, taskCount: 3000, matchedCount: 30 },
  // ~3332 render instances under Show-all — the #161 explosion scale.
  "show-all-2660": { totalNotes: 6000, taskCount: 3000, matchedCount: 70 },
  // The full production shape (heavy diagnosis / scheduled-job parity).
  "full-10k": {
    totalNotes: 10000,
    taskCount: 5000,
    matchedCount: 261,
    multiParentDist: [
      { parents: 2, count: 400 },
      { parents: 4, count: 120 },
      { parents: 7, count: 40 },
    ],
  },
};

/** The shared structural mix; presets/flags override the scale fields. */
function baseParams() {
  return {
    seed: 1,
    totalNotes: 6000,
    taskCount: 3000,
    matchedCount: 70,
    multiParentDist: [
      { parents: 2, count: 150 },
      { parents: 4, count: 40 },
      { parents: 7, count: 12 },
    ],
    maxDepth: 6,
    depDensity: 0.1,
    dateMix: { dated: 0.7, undated: 0.1, startOnly: 0.1, endOnly: 0.1 },
    cycleCount: 3,
    orphanCount: 6,
  };
}

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
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(
      `Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(", ")}`,
    );
    process.exit(1);
  }

  const params = { ...baseParams(), ...preset };
  if (args.seed !== undefined) params.seed = Number(args.seed);
  if (args.tasks !== undefined) params.taskCount = Number(args.tasks);
  if (args.notes !== undefined) params.totalNotes = Number(args.notes);
  if (args.matched !== undefined) params.matchedCount = Number(args.matched);

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
