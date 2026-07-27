#!/usr/bin/env node
/**
 * Pre-push review gate: a push is allowed only when BOTH local review layers
 * (ce-code-review and the local Codex review) have recorded a clean receipt
 * against the exact commit being pushed.
 *
 * The reviews themselves are agentic and run outside git; this script only
 * makes an unreviewed push mechanically impossible by demanding receipts.
 *
 *   node scripts/check-review-receipts.mjs record <layer>   # after a clean review of HEAD
 *   node scripts/check-review-receipts.mjs check            # pre-push hook entry point
 *
 * Receipts live in .git/ (per-clone, never committed) and bind to the HEAD
 * commit sha, so any new commit invalidates them.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_LAYERS = ['ce-code-review', 'codex-local'];

function gitTopLevelDir() {
  return execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
}

function headSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function receiptPath() {
  return join(gitTopLevelDir(), 'review-receipts.json');
}

function readReceipts() {
  try {
    return JSON.parse(readFileSync(receiptPath(), 'utf8'));
  } catch {
    return { sha: null, layers: {} };
  }
}

export function evaluateReceipts(receipts, sha, requiredLayers = REQUIRED_LAYERS) {
  if (receipts.sha !== sha) {
    return { ok: false, missing: [...requiredLayers], staleSha: receipts.sha };
  }
  const missing = requiredLayers.filter((layer) => !receipts.layers[layer]);
  return { ok: missing.length === 0, missing, staleSha: null };
}

function record(layer) {
  if (!REQUIRED_LAYERS.includes(layer)) {
    console.error(`unknown review layer "${layer}" — expected one of: ${REQUIRED_LAYERS.join(', ')}`);
    process.exit(1);
  }
  const sha = headSha();
  const receipts = readReceipts();
  const layers = receipts.sha === sha ? receipts.layers : {};
  layers[layer] = new Date().toISOString();
  writeFileSync(receiptPath(), `${JSON.stringify({ sha, layers }, null, 2)}\n`);
  console.log(`recorded clean ${layer} receipt for ${sha.slice(0, 7)}`);
}

function check() {
  const sha = headSha();
  const verdict = evaluateReceipts(readReceipts(), sha);
  if (verdict.ok) {
    console.log(`review receipts OK for ${sha.slice(0, 7)}: ${REQUIRED_LAYERS.join(' + ')}`);
    return;
  }
  const staleNote = verdict.staleSha
    ? ` (receipts are for ${verdict.staleSha.slice(0, 7)}, HEAD is ${sha.slice(0, 7)})`
    : '';
  console.error(`pre-push: missing clean review receipts for HEAD${staleNote}: ${verdict.missing.join(', ')}`);
  console.error('Run both local review layers against this commit, fix every finding, then record:');
  for (const layer of verdict.missing) {
    console.error(`  node scripts/check-review-receipts.mjs record ${layer}`);
  }
  process.exit(1);
}

const isDirectRun = process.argv[1]?.endsWith('check-review-receipts.mjs');
if (isDirectRun) {
  const [, , command, layer] = process.argv;
  if (command === 'record') record(layer);
  else if (command === 'check') check();
  else {
    console.error('usage: check-review-receipts.mjs record <layer> | check');
    process.exit(1);
  }
}
