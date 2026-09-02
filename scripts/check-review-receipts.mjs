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
 * local sha (deletions skipped, tag objects peeled to their commit); the
 * archival review-subject namespace is exempt once each of its refs proves to
 * be named by the full id of the commit it carries, and its refs are
 * write-once - never replaced or deleted through this hook (see
 * ARCHIVAL_SUBJECT_REF_PREFIX); any malformed line fails the push. Run manually without piped input it falls
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
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

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
 * Commits pushed here are the SUBJECTS of recorded review passes (the E11
 * benchmark corpus), preserved so a fresh clone can rebuild the diff each pass
 * read. They are intermediate states that were later squash-merged, so by
 * construction they carry no receipts of their own; nothing under this prefix
 * is a branch or a tag, and nothing deploys from it. Every other namespace
 * stays gated exactly as before. A ref here is a pin the corpus's recorded
 * ranges rebuild from, so it is write-once: a replacement (even by an honestly
 * named commit) or a deletion is refused rather than waved through as an
 * ordinary branch update or deletion would be. A pin is named by the FULL id
 * of its commit: an abbreviation is unique only until some later object
 * shares it, and nothing revalidates a pin after creation. The first 31 pins,
 * created before this rule, carry 7-character abbreviations and stay as they
 * are (the ref, not its name, is what a clone rebuilds from).
 */
export const ARCHIVAL_SUBJECT_REF_PREFIX = 'refs/e11-subjects/';

/**
 * The distinct pushed local shas, the archival subject refs (kept apart so the
 * caller can validate them - the prefix alone grants nothing), and every
 * nonblank line that is not a valid ref record - the caller must fail closed
 * on any invalid line, because a silently discarded line would let its ref
 * through ungated.
 */
export function parsePushedRefLines(stdinText) {
  const shas = new Set();
  const invalid = [];
  const archival = [];
  for (const line of stdinText.split('\n')) {
    if (line.trim() === '') continue;
    // Git separates the four fields with single ASCII spaces. A Unicode-aware
    // split would also cut on bytes git accepts inside a refname (U+00A0 and
    // friends), handing the validator a name shorter than the ref git creates.
    const trimmed = line.replace(/\r$/, '');
    const tokens = trimmed.split(' ');
    const localSha = tokens[1];
    if (tokens.length !== 4 || !SHA_PATTERN.test(localSha) || !SHA_PATTERN.test(tokens[3])) {
      invalid.push(trimmed);
      continue;
    }
    if (tokens[2].startsWith(ARCHIVAL_SUBJECT_REF_PREFIX)) archival.push({ ref: tokens[2], sha: localSha, remoteSha: tokens[3] });
    else if (!isDeletion(localSha)) shas.add(localSha);
  }
  return { shas: [...shas], invalid, archival };
}

/** Annotated tags push their tag object's sha; receipts key on commits. */
function peelToCommit(sha) {
  return git(['rev-parse', '--verify', `${sha}^{commit}`]).trim();
}

/**
 * The pushed object's own type (`git cat-file -t`). Not a peel: a tag object
 * that points at the subject commit is still a tag, and a ref that stores it
 * resolves to an object other than the commit it names.
 */
function objectType(sha) {
  return git(['cat-file', '-t', sha]).trim();
}

/**
 * A pin is a write-once ref created under the full id of its own commit. Each
 * clause is checked as stated, not through a proxy: the pushed object IS a
 * commit (its own type - a peel would admit a tag pointing at one); the ref's
 * name IS that commit's full id (no abbreviation resolves anything, so no
 * prefix-twin, decoy branch, or later collision can vouch or shadow); and the
 * push CREATES the ref (a replacement or a deletion would orphan the subject
 * the corpus recorded). One problem string per offending ref; empty means
 * clean.
 */
export function validateArchivalSubjects(archival, resolveType = objectType) {
  const problems = [];
  for (const entry of archival) {
    const problem = archivalSubjectProblem(entry, resolveType);
    if (problem !== null) problems.push(`${entry.ref}: ${problem}`);
  }
  return problems;
}

function archivalSubjectProblem({ ref, sha, remoteSha }, resolveType) {
  if (isDeletion(sha)) return 'deleting an archival subject is refused; the corpus rebuilds its ranges from it';
  if (!isDeletion(remoteSha)) return `archival subjects are write-once; this ref already exists on the remote (at ${remoteSha.slice(0, 7)})`;
  const type = typeOrMissing(sha, resolveType);
  if (type === 'missing') return `pushed object ${sha.slice(0, 7)} cannot be read as an object here`;
  if (type !== 'commit') return `pushed object ${sha.slice(0, 7)} is a ${type}, not a commit`;
  const name = ref.slice(ARCHIVAL_SUBJECT_REF_PREFIX.length);
  if (name !== sha) return `must be named by the full object id of the pushed commit ${sha.slice(0, 7)}, not "${name}"`;
  return null;
}

function typeOrMissing(sha, resolveType) {
  try {
    return resolveType(sha);
  } catch {
    return 'missing';
  }
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
function record(layer, sha = headSha(), findings = '') {
  if (!REQUIRED_LAYERS.includes(layer)) {
    console.error(`unknown review layer "${layer}" — expected one of: ${REQUIRED_LAYERS.join(', ')}`);
    process.exit(1);
  }
  if (!SHA_PATTERN.test(sha)) {
    console.error(`invalid commit sha "${sha}" — expected a full object name`);
    process.exit(1);
  }
  if (findings && !DIGEST_PATTERN.test(findings)) {
    console.error(`invalid review digest "${findings}" — expected a sha256 of the review output`);
    process.exit(1);
  }
  if (layer === PEER_LAYER && process.env[PEER_ATTESTATION_ENV] !== sha) {
    console.error(`${PEER_LAYER} is recorded BY the review, not alongside it.`);
    console.error(`  ${PEER_WRAPPER}`);
    process.exit(1);
  }
  const store = readReceipts();
  const entry = findings ? { at: new Date().toISOString(), findings } : new Date().toISOString();
  store.receipts[sha] = { ...store.receipts[sha], [layer]: entry };
  writeFileSync(receiptPath(), `${JSON.stringify(store, null, 2)}\n`);
  const kind = findings ? `acknowledged (findings ${findings.slice(0, 12)})` : 'clean';
  console.log(`recorded ${kind} ${layer} receipt for ${sha.slice(0, 7)}`);
}

/**
 * Findings a review produced and the maintainer accepted, rather than fixed.
 *
 * A reviewer whose job is to find things will find something, so a gate that
 * stamps only on a clean verdict is one no change can pass — and an unpassable
 * gate gets bypassed with --no-verify, which is worse than the honour system it
 * replaced. This is the third state, and it is deliberately narrow: the review
 * still has to have RUN — that is the wrapper's attestation, and it is what
 * makes this unforgeable, not the digest.
 *
 * The digest is a LABEL, and worth being precise about: it names the review
 * text that was accepted so two acknowledgements can be told apart and a stale
 * one is visible. Nothing re-hashes it later, because the review output is a
 * temp file this gate does not retain — so it identifies, it does not verify.
 * Claiming otherwise would be the same overclaim as a read-proof that matched
 * our own prompt.
 */
export function acknowledgedFindings(store, shas, requiredLayers = REQUIRED_LAYERS) {
  const accepted = [];
  for (const sha of shas) {
    for (const layer of requiredLayers) {
      const entry = store.receipts?.[sha]?.[layer];
      if (entry && typeof entry === 'object' && entry.findings) {
        accepted.push({ sha, layer, findings: entry.findings });
      }
    }
  }
  return accepted;
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

function refuseArchivalSubjects(problems) {
  console.error('pre-push: archival subject ref(s) refused - a pin is created once, under the name of its own commit:');
  for (const problem of problems) console.error(`  ${problem}`);
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

/** The commits to gate and the archival subjects the push carries alongside them. */
function pushToCheck(stdinText) {
  if (stdinText.trim() === '') return { shas: [headSha()], archival: [] };
  const { shas, invalid, archival } = parsePushedRefLines(stdinText);
  if (invalid.length > 0) refuseInvalidRefLines(invalid);
  const problems = validateArchivalSubjects(archival);
  if (problems.length > 0) refuseArchivalSubjects(problems);
  return { shas: peelPushedCommits(shas), archival };
}

function reportArchivalSubjects(archival) {
  if (archival.length === 0) return;
  const names = archival.map(({ ref }) => ref.slice(ARCHIVAL_SUBJECT_REF_PREFIX.length)).join(', ');
  console.log(`archival review subjects accepted without receipts (${ARCHIVAL_SUBJECT_REF_PREFIX}*): ${names}`);
}

function reportCleanReceipts(shas, archivalOnly) {
  if (archivalOnly) return;
  const short = shas.map((sha) => sha.slice(0, 7)).join(', ') || 'deletion-only push';
  console.log(`review receipts OK for ${short}: ${REQUIRED_LAYERS.join(' + ')}`);
}

/**
 * Printed on every push that rides on an acknowledgement, because the cost of
 * the third state is that a finding can be accepted once and then forgotten
 * forever. Saying it out loud each time is what keeps it a decision.
 */
function reportAcceptedFindings(accepted) {
  for (const { sha, layer, findings } of accepted) {
    console.log(`review receipt for ${sha.slice(0, 7)} carries accepted findings from ${layer} (review ${findings.slice(0, 12)})`);
  }
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

  const { shas, archival } = pushToCheck(stdinText);
  const store = readReceipts();
  const verdict = evaluateReceipts(store, shas);
  if (!verdict.ok) refuseMissingReceipts(verdict);
  reportAcceptedFindings(acknowledgedFindings(store, shas));
  reportArchivalSubjects(archival);
  reportCleanReceipts(shas, shas.length === 0 && archival.length > 0);
}

const isDirectRun = process.argv[1]?.endsWith('check-review-receipts.mjs');
if (isDirectRun) {
  const [, , command, layer, sha] = process.argv;
  const ackIndex = process.argv.indexOf('--acknowledged');
  // `||`, not `??`: an EMPTY value is the dangerous one. `??` let it through
  // as '' — falsy, so record() took the clean-receipt branch and a review that
  // found things was stored as one that found none. The sentinel routes every
  // unusable value into the digest guard instead.
  const findings = ackIndex === -1 ? '' : (process.argv[ackIndex + 1] || 'missing');
  if (command === 'record') record(layer, sha ?? headSha(), findings);
  else if (command === 'check') check();
  else {
    console.error('usage: check-review-receipts.mjs record <layer> | check');
    process.exit(1);
  }
}
