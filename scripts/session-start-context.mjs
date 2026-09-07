#!/usr/bin/env node
/**
 * SessionStart hook: emitted into every session's context before the first prompt.
 *
 * Exists because an invariant kept only by remembering it eventually loses to
 * momentum, and writing it down was not enough on its own: this repo lost
 * roughly a working day to a peer-review wrapper that hung after printing its
 * verdict while the agent waited on it.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';

/**
 * Resolved ONCE, here, and embedded into every command the contract names: the
 * heartbeat fires from wherever the session's shell is by then — a
 * subdirectory, another repository, a directory that is no repository at all —
 * and that shell does not carry the hook's CLAUDE_PROJECT_DIR.
 */
export function projectRoot(env = process.env) {
  const fromHook = env.CLAUDE_PROJECT_DIR;
  const root = fromHook || execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  return root.replaceAll('\\', '/');
}

/**
 * Claude Code hands every hook a JSON event on stdin: `source` says how the
 * session started (startup, resume, clear, compact, fork) and `transcript_path`
 * where its transcript lives. A terminal stdin is never read, so a hand run does
 * not wait for input.
 *
 * @param {{ isTTY?: boolean, fd?: number }} [stdin]
 */
export function sessionEvent(stdin = process.stdin) {
  if (stdin.isTTY) return {};
  try {
    const raw = readFileSync(stdin.fd ?? 0, 'utf8').trim();
    if (!raw) return {};
    const event = JSON.parse(raw);
    return { source: event.source, transcriptPath: event.transcript_path };
  } catch {
    // Something wrote an event we cannot read. It named neither a source nor a
    // transcript, so nothing downstream can establish that delivery is safe.
    return { unreadable: true };
  }
}

/**
 * A compaction leaves its own entry in the transcript, so a session resumed or
 * forked after compacting still carries the charter's checkpoint even though
 * its event source is no longer `compact`.
 *
 * The regex is a cheap prefilter over whole lines; the answer comes from
 * parsing the candidate, because the same words appear inside tool results
 * that merely carry transcript-shaped data.
 */
const COMPACTION_MARKER = /compact_boundary|isCompactSummary/;
export const SCAN_CHUNK_BYTES = 64 * 1024;

function entryIsCompaction(line) {
  if (!COMPACTION_MARKER.test(line)) return false;
  try {
    const entry = JSON.parse(line);
    return entry.subtype === 'compact_boundary' || entry.isCompactSummary === true;
  } catch {
    // A line carrying the marker that will not parse is a half-written entry,
    // and the entry a transcript is most likely caught mid-write is the
    // compaction itself. Unknown counts as degraded, as it does for a
    // transcript that will not open at all.
    return true;
  }
}

/**
 * Scanned in chunks with an early exit because a long session's transcript runs
 * to tens of megabytes. `unreadable` is its own answer: a transcript the event
 * named but we could not read cannot prove the session is undegraded, and the
 * safe direction for a checkpoint is to assume it is.
 */
export function transcriptCompactionState(transcriptPath) {
  if (!transcriptPath) return 'none';
  let descriptor;
  try {
    descriptor = openSync(transcriptPath, 'r');
  } catch {
    return 'unreadable';
  }
  try {
    const buffer = Buffer.alloc(SCAN_CHUNK_BYTES);
    let partialLine = '';
    for (;;) {
      const read = readSync(descriptor, buffer, 0, SCAN_CHUNK_BYTES, null);
      if (read === 0) return entryIsCompaction(partialLine) ? 'compacted' : 'clean';
      const lines = (partialLine + buffer.toString('utf8', 0, read)).split('\n');
      partialLine = lines.pop() ?? '';
      if (lines.some(entryIsCompaction)) return 'compacted';
    }
  } catch {
    return 'unreadable';
  } finally {
    closeSync(descriptor);
  }
}

/** Only these carry a prior session's transcript forward; the others start a fresh one. */
const SOURCES_INHERITING_A_TRANSCRIPT = new Set(['resume', 'fork']);

export function sessionCompacted(event) {
  if (event.unreadable) return true;
  if (event.source === 'compact') return true;
  const state = transcriptCompactionState(event.transcriptPath);
  if (state === 'compacted') return true;
  return state === 'unreadable' && SOURCES_INHERITING_A_TRANSCRIPT.has(event.source);
}

/**
 * The root reaches a shell the heartbeat opens later, so it is quoted where a
 * `$`, a backtick or a `$(...)` in an otherwise valid clone path cannot expand.
 */
export function shellQuoted(root) {
  return `'${root.replaceAll("'", `'\\''`)}'`;
}

export function receiptCheckCommand(root) {
  return `cd ${shellQuoted(root)} && node scripts/check-review-receipts.mjs check`;
}

function readSteps(root) {
  return [
    `  1. cd ${shellQuoted(root)} && git status -sb && git log --oneline -1`,
    `  2. ${receiptCheckCommand(root)}`,
    '     (exit 0 means BOTH receipts are stamped for HEAD; otherwise its "missing" line',
    '     names the layers still unstamped)',
    `  3. cd ${shellQuoted(root)} && gh pr view <n> --json headRefOid,mergeStateStatus,statusCheckRollup`,
    `  4. cd ${shellQuoted(root)} && gh api graphql -f query='{ repository(owner:"<owner>",name:"<repo>") { pullRequest(number:<n>) { reviewThreads(first:100) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first:1) { nodes { body } } } } } } }'`,
    '     page on with endCursor while hasNextPage is true, then count the threads with',
    '     isResolved false across every page, reading each body, not just the count',
    `     and cd ${shellQuoted(root)} && gh pr view <n> --json reviews,comments, because a`,
    '     blocking finding often arrives as a review body or a top-level comment that never',
    '     becomes an inline thread, and a thread count alone reports zero for it',
  ];
}

function deliverySteps(root) {
  return [
    `  5. cd ${shellQuoted(root)} && git push -u origin HEAD`,
    '     only when local is ahead of origin and step 2 exited 0',
    `  6. cd ${shellQuoted(root)} && gh pr merge <n> --squash --delete-branch --match-head-commit <headRefOid-from-step-3>`,
    '     only when step 2 exited 0, that headRefOid equals the local HEAD, CI is terminal-green,',
    '     and step 4 found nothing outstanding in any channel it read: zero unresolved threads,',
    '     and no review body or top-level comment carrying a finding you have neither addressed',
    '     nor recorded. Never with an unresolved final-gate thread.',
    `  7. cd ${shellQuoted(root)} && node scripts/check-review-receipts.mjs record ce-code-review <reviewed-sha>`,
    '     only after a clean layer-one review of exactly that commit, never a moving HEAD',
    `  8. cd ${shellQuoted(root)} && bash scripts/cross-model-peer-review.sh <base> <report> --record`,
    '     started in the background, never awaited in the foreground. --acknowledge re-runs the',
    '     review and stamps the digest of THAT run, so it accepts whatever the new run finds,',
    '     including a finding no one has read yet. Read the report it wrote before you treat its',
    '     receipt as acceptance, and record what you accepted where a later session will look:',
    '     the backlog for a deferred finding, a commit for a fixed one.',
  ];
}

const PEER_WRAPPER_FAILURE_MODE = [
  'KNOWN FAILURE MODE, do not rediscover it:',
  '  scripts/cross-model-peer-review.sh runs codex exec synchronously and stamps the',
  '  cross-model-peer receipt only after codex returns. codex can write its final line,',
  "  VERDICT: CLEAN|FINDINGS, into the report file (the wrapper's second argument) and never",
  '  exit: the wrapper then never records, so no receipt ever appears and the job looks like',
  "  a running review. The report's VERDICT line is the signal that the review finished; the",
  '  receipt is the signal that the gate accepted it. Wait on those in the background and',
  '  never in the foreground: cron prompts fire only while the REPL is idle, so a foreground',
  '  wait that outlasts one heartbeat period silences the very check that catches a hung round.',
  '  Start a round, end the turn, and let the heartbeat decide; never start a second round',
  '  while a wrapper for this HEAD is alive:',
  '  - receipt landed (the "missing" line the check prints for HEAD no longer names',
  '    cross-model-peer): run and record ce-code-review, push.',
  "  - VERDICT line present, receipt still missing, and that round's codex.exe (the child of",
  "    the wrapper bash whose arguments name this round's report file; the sentinel reaches",
  '    only the diff file, so processes show only their arguments) is still running with the',
  '    report mtime older than ~15 min: hung. Kill that codex.exe and its pwsh child by PID',
  '    only, never blanket; archive the report; re-run the wrapper as the next round.',
  '  - that wrapper bash is alive with no codex child and neither the report nor its .stderr',
  '    has grown for ~15 min: stalled in its own git fetch or record step. Kill that wrapper by',
  '    PID only; archive the report; re-run.',
  '  - VERDICT line present, receipt still missing, and neither a codex child',
  "    nor a wrapper bash whose arguments name this round's report file is alive: the wrapper",
  '    already exited nonzero (FINDINGS without --acknowledge, dirty tree, HEAD moved, no',
  '    sentinel): refused, no receipt is coming. Read its stderr and the report, fix, re-run.',
  '  - no VERDICT line, no receipt, and nothing alive: the round never produced a review at all.',
  '    codex exited nonzero, or the wrapper refused before it ever ran. Read its stderr, fix the',
  '    cause, re-run. This is the branch a bare "still running" answer hides.',
  '',
  'General rule this instantiates: any background worker, workflow, or e2e run gets a',
  'heartbeat armed at the same time it is started, and every wait is on an OBSERVABLE',
  'completion signal (a receipt, a file, an API status) rather than on a process returning.',
  '',
];

/**
 * A compacted session gets a different contract, not the same one with a warning
 * on top: it still sweeps a heartbeat armed before the compaction, because that
 * one would go on pushing and merging from a context the charter has stopped.
 */
function compactedContract(root) {
  return [
    "CONTEXT WAS COMPACTED. This session's transcript carries a compaction, which is why this",
    'appears even on a resume or a fork rather than only on the compaction itself. The',
    'engineering charter ends a session at the nearest green checkpoint on compaction and hands',
    'over by mechanism (git, the plan on main, the backlog), never by pushing a degraded context',
    'onward. Delivery work stops here: no implementation, no review, no receipt recording, no',
    'push, no merge. The fresh session earns both receipt layers before any push. That holds',
    'however complete your context feels and whether or not you already handed over earlier in',
    'this transcript; only a new session clears it.',
    '',
    'Run CronList and CronDelete every job whose prompt starts with HEARTBEAT, then arm nothing:',
    'a heartbeat armed before the compaction carries the delivery contract this session no',
    'longer has, and would push and merge on its own schedule from here.',
    '',
    `Read state to find the checkpoint, from the project root this session started in, ${root}:`,
    ...readSteps(root),
    'and then: report where things stand in ONE line, persist what a fresh session needs',
    '(git, the plan on main, the backlog, agent memory), and stop.',
    '',
  ].join('\n');
}

function deliveryContract(root) {
  return [
    'HEARTBEAT CONTRACT (session-start hook, non-negotiable):',
    '',
    'Before doing anything else in this session, run CronList. This hook also fires on resume,',
    'compaction, clear and fork, so a heartbeat may already be armed, possibly under an older',
    'contract: CronDelete every job whose prompt starts with HEARTBEAT, then arm exactly one',
    'fresh recurring heartbeat with CronCreate, roughly every 5-8 minutes, whose prompt starts',
    'with HEARTBEAT and re-checks any in-flight work and ACTS on it rather than reporting it.',
    'Two heartbeats double every push and merge check. Arm it even if no background work exists',
    'yet: the moment you start any, the heartbeat must already be running. Do this before',
    'answering the first prompt, and never treat "I will check later" as a substitute.',
    '',
    'Every heartbeat command, reads and writes alike, runs from the project root this session',
    `started in, ${root}, because the shell may be anywhere by the time the heartbeat fires:`,
    ...readSteps(root),
    ...deliverySteps(root),
    'and then: push (5) or merge (6) when their conditions hold; otherwise say so in ONE line',
    'and stop.',
    '',
    ...PEER_WRAPPER_FAILURE_MODE,
  ].join('\n');
}

export function heartbeatContract(root, compacted = false) {
  return compacted ? compactedContract(root) : deliveryContract(root);
}

const isDirectRun = process.argv[1]?.endsWith('session-start-context.mjs');
if (isDirectRun) process.stdout.write(heartbeatContract(projectRoot(), sessionCompacted(sessionEvent())));
