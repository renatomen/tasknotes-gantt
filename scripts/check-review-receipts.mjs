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
 * A ref whose whole pushed range changes nothing outside the docs tree is
 * exempt and needs no receipts — prose carries no reviewable behavior. The
 * exemption is decided per ref over that ref's own range, so a push carrying
 * both a docs ref and a code ref still gates the code one, and a range mixing
 * docs with anything else is not exempt. Every ambiguity fails CLOSED: an
 * unresolvable range, a failed git call, and an empty path list all demand
 * receipts, because the cost of a wrong exemption is unreviewed code. That
 * includes a branch the destination does not have yet — its first push is
 * gated, since nothing local can be trusted to say where its range begins.
 *
 * A receipt attests that the chain of reviews ending at that commit was run
 * clean - reviews diff against the previously receipted or pushed state, so
 * the tip receipt covers the ancestors pushed with it. The mechanism binds
 * review artifacts to shas; that each review honestly covered its range is
 * the review process's responsibility, not this script's.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_LAYERS = ['ce-code-review', 'codex-local'];

/** The exempt subtree, matched with its separator so a sibling like `docsy/` cannot pass. */
export const DOCS_PREFIX = 'docs/';

const SHA_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Flags shared by both path readings, each pinning a behavior that repository or
 * user configuration can otherwise turn off underneath the gate:
 *
 * - NUL-separated names, so git never quotes a path it would then have to escape.
 * - Renames read as delete-plus-add, so a file moved out of the docs tree cannot
 *   hide behind its new path alone.
 * - Submodule changes always shown, because an ignore setting would drop a
 *   gitlink outside the docs tree from both readings while a docs path kept the
 *   union non-empty.
 *
 * The per-commit reading adds an explicit merge-diff format for the same reason:
 * the shorthand for "show merge diffs" defers its format to configuration, and
 * a repository that disables it silently hides every path a merge introduced.
 */
const PATH_READING_FLAGS = [
  '--name-only',
  '-z',
  '--no-renames',
  '--ignore-submodules=none',
];

function isDeletion(sha) {
  return /^0+$/.test(sha);
}

/**
 * Every call runs with replacement objects disabled, because this script exists
 * to describe what a push will TRANSFER. A replaced object rewrites what `diff`
 * and `log` report while the pack transfer still sends the original, so honoring
 * replacements would let the gate inspect one commit and the remote receive
 * another.
 *
 * `quiet` silences the subprocess's own stderr for calls whose failure is
 * expected and handled here — an unresolvable range must read as one clear
 * refusal, not as a bare git fatal the caller has to interpret.
 */
function git(args, { quiet = false } = {}) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : undefined,
  });
}

function gitDir() {
  return git(['rev-parse', '--git-dir']).trim();
}

/**
 * Let git resolve a repository path rather than composing one. A linked worktree
 * has its own git dir but shares the repository-wide files, so joining onto
 * `--git-dir` would look inside the worktree for something that lives beside it.
 */
function gitPath(relative) {
  return git(['rev-parse', '--git-path', relative]).trim();
}

function headSha() {
  return git(['rev-parse', 'HEAD']).trim();
}

function shortSha(sha) {
  return sha.slice(0, 7);
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
 * The distinct pushed ref records - each pairing the local sha being pushed with
 * the remote sha its range is measured from - plus every nonblank line that is
 * not a valid ref record. The caller must fail closed on any invalid line,
 * because a silently discarded line would let its ref through ungated.
 *
 * Both shas are kept because the remote one is the only honest diff base: one
 * tip pushed to two refs from different remote states is two different ranges.
 */
export function parsePushedRefLines(stdinText) {
  const pushes = [];
  const seen = new Set();
  const invalid = [];
  for (const line of stdinText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const tokens = trimmed.split(/\s+/);
    const [, localSha, , remoteSha] = tokens;
    if (tokens.length !== 4 || !SHA_PATTERN.test(localSha) || !SHA_PATTERN.test(remoteSha)) {
      invalid.push(trimmed);
      continue;
    }
    if (isDeletion(localSha)) continue;
    const key = `${localSha} ${remoteSha}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pushes.push({ localSha, remoteSha });
  }
  return { pushes, invalid };
}

/** Annotated tags push their tag object's sha; receipts key on commits. */
function peelToCommit(sha) {
  return git(['rev-parse', '--verify', `${sha}^{commit}`]).trim();
}

/**
 * Whether a graft file is in play. Grafts fake commit ancestry for every history
 * command, and unlike replacement objects no flag turns them off — so a grafted
 * range can read as docs-only while the push still transfers the commits the
 * graft hid. A present-but-unreadable file counts as active: the reason it
 * cannot be read is exactly the reason it cannot be trusted absent.
 */
function graftsActive() {
  const graftFile = process.env.GIT_GRAFT_FILE ?? gitPath('info/grafts');
  if (!existsSync(graftFile)) return false;
  try {
    return readFileSync(graftFile, 'utf8')
      .split('\n')
      .some((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  } catch {
    return true;
  }
}

/**
 * What a push would introduce: the base for a net tree diff, plus the rev-list
 * arguments naming each introduced commit. Null when git handed us no
 * authoritative base, which forfeits the exemption.
 *
 * Only a ref the destination already has earns one, because only then does git
 * supply that destination's current tip. For a ref it does not have yet there is
 * no cheap trustworthy base: local tracking refs answer about a different moment
 * and sometimes a different destination, so any reading of them can exclude a
 * code-bearing commit the push would still introduce. Gating a new branch's
 * first push costs one review; guessing its base costs the invariant.
 */
function pushRange(localSha, remoteSha) {
  if (isDeletion(remoteSha)) return null;
  return { base: remoteSha, revs: [`${remoteSha}..${localSha}`] };
}

/**
 * Every path a push would change, or null when the range cannot be resolved - a
 * ref the destination does not have yet, an unfetched tip, a failed git call.
 *
 * The union of two readings, because each is blind where the other sees. The net
 * tree diff covers the endpoint state. The per-commit listing covers a change
 * added and then reverted inside the range, which the net diff cancels to
 * nothing while the push still carries the commit that introduced it.
 *
 * The per-commit listing asks for merge diffs explicitly: git omits them by
 * default, so without that a path introduced by one merge resolution and undone
 * by another would appear in neither reading.
 *
 * Paths are read NUL-separated so git never quotes them, and renames are read as
 * delete-plus-add so a file moved out of the docs tree cannot hide behind its
 * new path alone.
 */
function changedPathsForPush({ localSha, remoteSha }) {
  try {
    if (graftsActive()) return null;
    const range = pushRange(localSha, remoteSha);
    if (range === null) return null;
    const netDiff = git(
      ['diff', ...PATH_READING_FLAGS, range.base, localSha],
      { quiet: true },
    );
    const perCommit = git(
      [
        'log',
        '--format=',
        ...PATH_READING_FLAGS,
        // Both switchable defaults the log reading depends on, pinned here rather
        // than inherited: the merge-diff shorthand takes its format from
        // configuration, and a root commit's own diff can be configured away —
        // which would hide every path an orphan root introduces.
        '--diff-merges=separate',
        '--root',
        ...range.revs,
      ],
      { quiet: true },
    );
    return [...new Set(`${netDiff}\0${perCommit}`.split('\0').filter((path) => path !== ''))];
  } catch {
    return null;
  }
}

/**
 * Whether a resolved change list is confined to the docs tree. An unresolved
 * range (null) and an empty list are both refused: neither is evidence that
 * nothing outside docs changed.
 */
export function isDocsOnlyChange(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return false;
  return changedPaths.every((path) => path.startsWith(DOCS_PREFIX));
}

/**
 * Split the pushed shas into the exempt and the gated. A sha is exempt only when
 * EVERY record carrying it is exempt, so a tip pushed to two refs cannot inherit
 * one ref's docs-only range to cover another ref's code.
 */
export function partitionPushedShas(pushes, isExempt) {
  const verdictBySha = new Map();
  for (const push of pushes) {
    const exempt = isExempt(push);
    const known = verdictBySha.get(push.localSha);
    verdictBySha.set(push.localSha, known === undefined ? exempt : known && exempt);
  }
  const exempt = [];
  const gated = [];
  for (const [sha, isClean] of verdictBySha) (isClean ? exempt : gated).push(sha);
  return { exempt, gated };
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
  console.log(`recorded clean ${layer} receipt for ${shortSha(sha)}`);
}

/**
 * The piped ref lines, and whether reading them failed. The two are NOT the same
 * absence: no input means a manual run, which gates HEAD, while a failed read
 * means the pushed refs are unknown. Collapsing the second into the first would
 * gate HEAD on a real push and let an unreceipted ref through whenever HEAD
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

function refuse(headline, details) {
  console.error(headline);
  for (const detail of details) console.error(`  ${detail}`);
  process.exit(1);
}

function reportVerdict(gatedShas, exemptShas) {
  for (const sha of exemptShas) {
    console.log(`review receipts not required for ${shortSha(sha)}: changes only ${DOCS_PREFIX}`);
  }
  const verdict = evaluateReceipts(readReceipts(), gatedShas);
  if (verdict.ok) {
    if (gatedShas.length > 0) {
      console.log(
        `review receipts OK for ${gatedShas.map(shortSha).join(', ')}: ${REQUIRED_LAYERS.join(' + ')}`,
      );
    } else if (exemptShas.length === 0) {
      console.log('review receipts OK: deletion-only push');
    }
    return;
  }
  const missingLayers = new Set();
  for (const [sha, missing] of Object.entries(verdict.missingBySha)) {
    console.error(`pre-push: missing clean review receipts for ${shortSha(sha)}: ${missing.join(', ')}`);
    for (const layer of missing) missingLayers.add(layer);
  }
  console.error('Run both local review layers against each pushed commit, fix every finding, then record:');
  for (const layer of missingLayers) {
    console.error(`  node scripts/check-review-receipts.mjs record ${layer}`);
  }
  process.exit(1);
}

function check() {
  const { text: stdinText, failed } = readPipedStdin();
  if (failed) {
    refuse('pre-push: cannot read the pushed ref lines - refusing to gate blind', []);
  }
  // A manual run carries no pushed range, so it gates HEAD outright: the
  // docs-only exemption needs a range and never fires without one.
  if (stdinText.trim() === '') {
    reportVerdict([headSha()], []);
    return;
  }
  const { pushes, invalid } = parsePushedRefLines(stdinText);
  if (invalid.length > 0) {
    refuse('pre-push: unparseable ref line(s) - refusing to gate blind:', invalid);
  }
  let records;
  try {
    records = pushes.map((push) => ({ ...push, localSha: peelToCommit(push.localSha) }));
  } catch (error) {
    refuse('pre-push: cannot resolve a pushed object to a commit - refusing to gate blind', [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const { exempt, gated } = partitionPushedShas(records, (push) =>
    isDocsOnlyChange(changedPathsForPush(push)),
  );
  reportVerdict(gated, exempt);
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
