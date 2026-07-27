#!/usr/bin/env node
/**
 * Pre-push review gate: a push is allowed only when BOTH local review layers
 * (ce-code-review and the local Codex review) have recorded a clean receipt
 * against every commit being pushed.
 *
 * The reviews themselves are agentic and run outside git; this script only
 * makes an unreviewed push mechanically impossible by demanding receipts.
 *
 *   node scripts/check-review-receipts.mjs record <layer>   # after a clean review of HEAD
 *   node scripts/check-review-receipts.mjs check            # pre-push hook entry point
 *
 * `check` reads git's pre-push stdin lines ("<local-ref> <local-sha>
 * <remote-ref> <remote-sha>") and demands receipts for every distinct pushed
 * local sha (deletions skipped); run manually without piped input it falls
 * back to HEAD. Receipts live in .git/ (per-clone, never committed), keyed by
 * commit sha: {"receipts": {"<sha>": {"<layer>": "<iso timestamp>"}}}.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_LAYERS = ['ce-code-review', 'codex-local'];

const DELETED_REF_SHA = '0'.repeat(40);

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
    const parsed = JSON.parse(readFileSync(receiptPath(), 'utf8'));
    return typeof parsed?.receipts === 'object' && parsed.receipts !== null
      ? parsed
      : { receipts: {} };
  } catch {
    return { receipts: {} };
  }
}

/** The distinct local shas a pre-push stdin payload pushes (deletions skipped). */
export function parsePushedLocalShas(stdinText) {
  const shas = stdinText
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((sha) => sha !== undefined && /^[0-9a-f]{40}$/.test(sha) && sha !== DELETED_REF_SHA);
  return [...new Set(shas)];
}

export function evaluateReceipts(store, shas, requiredLayers = REQUIRED_LAYERS) {
  const missingBySha = {};
  for (const sha of shas) {
    const layers = store.receipts?.[sha] ?? {};
    const missing = requiredLayers.filter((layer) => !layers[layer]);
    if (missing.length > 0) missingBySha[sha] = missing;
  }
  return { ok: Object.keys(missingBySha).length === 0, missingBySha };
}

function record(layer) {
  if (!REQUIRED_LAYERS.includes(layer)) {
    console.error(`unknown review layer "${layer}" — expected one of: ${REQUIRED_LAYERS.join(', ')}`);
    process.exit(1);
  }
  const sha = headSha();
  const store = readReceipts();
  store.receipts[sha] = { ...store.receipts[sha], [layer]: new Date().toISOString() };
  writeFileSync(receiptPath(), `${JSON.stringify(store, null, 2)}\n`);
  console.log(`recorded clean ${layer} receipt for ${sha.slice(0, 7)}`);
}

function readPipedStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function check() {
  const stdinText = readPipedStdin();
  // Piped ref lines gate the pushed shas (a deletion-only push gates nothing);
  // a manual run with no piped input falls back to gating HEAD.
  const shas = stdinText.trim() === '' ? [headSha()] : parsePushedLocalShas(stdinText);
  const verdict = evaluateReceipts(readReceipts(), shas);
  if (verdict.ok) {
    const short = shas.map((sha) => sha.slice(0, 7)).join(', ') || 'deletion-only push';
    console.log(`review receipts OK for ${short}: ${REQUIRED_LAYERS.join(' + ')}`);
    return;
  }
  const missingLayers = new Set();
  for (const [sha, missing] of Object.entries(verdict.missingBySha)) {
    console.error(`pre-push: missing clean review receipts for ${sha.slice(0, 7)}: ${missing.join(', ')}`);
    for (const layer of missing) missingLayers.add(layer);
  }
  console.error('Run both local review layers against each pushed commit, fix every finding, then record:');
  for (const layer of missingLayers) {
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
