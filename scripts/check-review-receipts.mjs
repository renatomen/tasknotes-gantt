#!/usr/bin/env node
/**
 * Pre-push review gate: a push is allowed only when BOTH local review layers
 * (ce-code-review and an independent cross-model peer) have recorded a clean receipt
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

export const REQUIRED_LAYERS = ['ce-code-review', 'cross-model-peer'];

/**
 * The peer layer is earned by a wrapper that runs a real review and only then
 * records; this env var is how the wrapper says so, naming the sha it reviewed.
 *
 * Without it, `record cross-model-peer` was a bare command anyone could type —
 * and the refusal message printed that very command as the fix. Five PRs were
 * receipted that way, each with a residual note admitting no peer had run. A
 * layer whose receipt can be stamped by hand is decoration, so stamping it by
 * hand now requires deliberately forging the attestation instead of following
 * the tool's own advice.
 */
const PEER_LAYER = 'cross-model-peer';
const PEER_ATTESTATION_ENV = 'OG_PEER_REVIEW_ATTESTED_SHA';
const PEER_WRAPPER = 'bash scripts/cross-model-peer-review.sh <base> <out> --record';

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

/**
 * `sha` binds the receipt to the commit that was actually reviewed. A long
 * review can outlive its own subject: re-reading HEAD here would stamp
 * whatever commit exists when recording happens, which is how a clean verdict
 * lands on unreviewed work. Callers that reviewed HEAD may omit it.
 */
function record(layer, sha = headSha()) {
  if (!REQUIRED_LAYERS.includes(layer)) {
    console.error(`unknown review layer "${layer}" — expected one of: ${REQUIRED_LAYERS.join(', ')}`);
    process.exit(1);
  }
  if (!SHA_PATTERN.test(sha)) {
    console.error(`invalid commit sha "${sha}" — expected a full object name`);
    process.exit(1);
  }
  if (layer === PEER_LAYER && process.env[PEER_ATTESTATION_ENV] !== sha) {
    console.error(`${PEER_LAYER} is recorded BY the review, not alongside it.`);
    console.error(`  ${PEER_WRAPPER}`);
    process.exit(1);
  }
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

function refuseUnreadableRefLines() {
  console.error('pre-push: cannot read the pushed ref lines - refusing to gate blind');
  process.exit(1);
}

function refuseInvalidRefLines(invalid) {
  console.error('pre-push: unparseable ref line(s) - refusing to gate blind:');
  for (const line of invalid) console.error(`  ${line}`);
  process.exit(1);
}

function peelPushedCommits(pushed) {
  try {
    return [...new Set(pushed.map(peelToCommit))];
  } catch (error) {
    console.error('pre-push: cannot resolve a pushed object to a commit - refusing to gate blind');
    console.error(`  ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function pushedCommitShas(stdinText) {
  const { shas, invalid } = parsePushedRefLines(stdinText);
  if (invalid.length > 0) refuseInvalidRefLines(invalid);
  return peelPushedCommits(shas);
}

function shasToCheck(stdinText) {
  if (stdinText.trim() === '') return [headSha()];
  return pushedCommitShas(stdinText);
}

function reportCleanReceipts(shas) {
  const short = shas.map((sha) => sha.slice(0, 7)).join(', ') || 'deletion-only push';
  console.log(`review receipts OK for ${short}: ${REQUIRED_LAYERS.join(' + ')}`);
}

function refuseMissingReceipts(verdict) {
  const missingLayers = new Set();
  for (const [sha, missing] of Object.entries(verdict.missingBySha)) {
    console.error(`pre-push: missing clean review receipts for ${sha.slice(0, 7)}: ${missing.join(', ')}`);
    for (const layer of missing) missingLayers.add(layer);
  }
  console.error('Run both local review layers against each pushed commit, fix every finding, then record:');
  for (const layer of missingLayers) {
    // Never print a bare `record cross-model-peer`: that is the hand-stamp this
    // gate exists to prevent, and advertising it is how it kept happening.
    console.error(layer === PEER_LAYER ? `  ${PEER_WRAPPER}` : `  node scripts/check-review-receipts.mjs record ${layer}`);
  }
  process.exit(1);
}

function check() {
  const { text: stdinText, failed } = readPipedStdin();
  if (failed) refuseUnreadableRefLines();

  const shas = shasToCheck(stdinText);
  const verdict = evaluateReceipts(readReceipts(), shas);
  if (verdict.ok) {
    reportCleanReceipts(shas);
    return;
  }
  refuseMissingReceipts(verdict);
}

const isDirectRun = process.argv[1]?.endsWith('check-review-receipts.mjs');
if (isDirectRun) {
  const [, , command, layer, sha] = process.argv;
  if (command === 'record') record(layer, sha ?? headSha());
  else if (command === 'check') check();
  else {
    console.error('usage: check-review-receipts.mjs record <layer> | check');
    process.exit(1);
  }
}
