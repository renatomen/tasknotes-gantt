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
 * local sha (deletions skipped, tag objects peeled to their commit); any
 * malformed line fails the push. Run manually without piped input it falls
 * back to HEAD. Receipts live in .git/ (per-clone, never committed), keyed by
 * commit sha: {"receipts": {"<sha>": {"<layer>": "<iso timestamp>"}}}.
 *
 * A receipt attests that the chain of reviews ending at that commit was run
 * clean - reviews diff against the previously receipted or pushed state, so
 * the tip receipt covers the ancestors pushed with it. The mechanism binds
 * review artifacts to shas; that each review honestly covered its range is
 * the review process's responsibility, not this script's.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_LAYERS = ['ce-code-review', 'codex-local'];

const SHA_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

function isDeletion(sha) {
  return /^0+$/.test(sha);
}

/**
 * Replacement objects are disabled on every call: they rewrite what git reports
 * while a push still transfers the original, so honoring them would let this
 * script reason about one commit while the remote receives another.
 */
function git(args) {
  return execFileSync('git', ['--no-replace-objects', ...args], { encoding: 'utf8' });
}

function gitDir() {
  return git(['rev-parse', '--git-dir']).trim();
}

function headSha() {
  return git(['rev-parse', 'HEAD']).trim();
}

function receiptPath() {
  return join(gitDir(), 'review-receipts.json');
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

/**
 * The distinct pushed local shas plus every nonblank line that is not a valid
 * ref record - the caller must fail closed on any invalid line, because a
 * silently discarded line would let its ref through ungated.
 */
export function parsePushedRefLines(stdinText) {
  const shas = new Set();
  const invalid = [];
  for (const line of stdinText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const tokens = trimmed.split(/\s+/);
    const localSha = tokens[1];
    if (tokens.length !== 4 || !SHA_PATTERN.test(localSha) || !SHA_PATTERN.test(tokens[3])) {
      invalid.push(trimmed);
      continue;
    }
    if (!isDeletion(localSha)) shas.add(localSha);
  }
  return { shas: [...shas], invalid };
}

/** Annotated tags push their tag object's sha; receipts key on commits. */
function peelToCommit(sha) {
  return git(['rev-parse', '--verify', `${sha}^{commit}`]).trim();
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

/**
 * The piped ref lines, and whether reading them failed. The two are NOT the same
 * absence: no input means a manual run, which gates HEAD, while a failed read
 * means the pushed refs are unknown. Collapsing the second into the first would
 * gate HEAD during a real push and let an unreceipted ref through whenever HEAD
 * happened to hold receipts.
 */
function readPipedStdin() {
  if (process.stdin.isTTY) return { text: '', failed: false };
  try {
    return { text: readFileSync(0, 'utf8'), failed: false };
  } catch {
    return { text: '', failed: true };
  }
}

function check() {
  const { text: stdinText, failed } = readPipedStdin();
  if (failed) {
    console.error('pre-push: cannot read the pushed ref lines - refusing to gate blind');
    process.exit(1);
  }
  // Piped ref lines gate the pushed shas (a deletion-only push gates nothing);
  // a manual run with no piped input falls back to gating HEAD.
  let shas;
  if (stdinText.trim() === '') {
    shas = [headSha()];
  } else {
    const { shas: pushed, invalid } = parsePushedRefLines(stdinText);
    if (invalid.length > 0) {
      console.error('pre-push: unparseable ref line(s) - refusing to gate blind:');
      for (const line of invalid) console.error(`  ${line}`);
      process.exit(1);
    }
    try {
      shas = [...new Set(pushed.map(peelToCommit))];
    } catch (error) {
      console.error('pre-push: cannot resolve a pushed object to a commit - refusing to gate blind');
      console.error(`  ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }
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
