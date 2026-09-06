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

export function receiptCheckCommand(root) {
  return `cd "${root}" && node scripts/check-review-receipts.mjs check`;
}

export function heartbeatContract(root) {
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
    `Every heartbeat command, reads and writes alike, runs from the project root this session`,
    `started in, ${root}, because the shell may be anywhere by the time the heartbeat fires:`,
    `  1. cd "${root}" && git status -sb && git log --oneline -1`,
    `  2. ${receiptCheckCommand(root)}`,
    '     (exit 0 means BOTH receipts are stamped for HEAD; otherwise its "missing" line',
    '     names the layers still unstamped)',
    `  3. cd "${root}" && gh pr view <n> --json headRefOid,mergeStateStatus,statusCheckRollup`,
    `  4. cd "${root}" && gh api graphql -f query='{ repository(owner:"<owner>",name:"<repo>") { pullRequest(number:<n>) { reviewThreads(first:100) { nodes { isResolved comments(first:1) { nodes { body } } } } } } }'`,
    '     and count the threads with isResolved false, reading each body, not just the count',
    `  5. cd "${root}" && git push -u origin HEAD`,
    '     only when local is ahead of origin and step 2 exited 0',
    `  6. cd "${root}" && gh pr merge <n> --squash --delete-branch`,
    '     only when headRefOid equals the local HEAD, CI is terminal-green, and zero threads',
    '     are unresolved; never with an unresolved final-gate thread',
    `  7. cd "${root}" && node scripts/check-review-receipts.mjs record ce-code-review`,
    '     only after a clean layer-one review of HEAD',
    `  8. cd "${root}" && bash scripts/cross-model-peer-review.sh <base> <report> --record --acknowledge`,
    '     started in the background, never awaited in the foreground',
    'and then: push (5) or merge (6) when their conditions hold; otherwise say so in ONE line',
    'and stop.',
    '',
    'KNOWN FAILURE MODE, do not rediscover it:',
    '  scripts/cross-model-peer-review.sh runs codex exec synchronously and stamps the',
    '  cross-model-peer receipt only after codex returns. codex can write its final line,',
    "  VERDICT: CLEAN|FINDINGS, into the report file (the wrapper's second argument) and never",
    '  exit: the wrapper then never records, so no receipt ever appears and the job looks like',
    "  a running review. The report's VERDICT line is the signal that the review finished; the",
    '  receipt is the signal that the gate accepted it. Wait on those in the background and',
    '  never in the foreground: cron prompts fire only while the REPL is idle, so a foreground',
    '  wait that outlasts one heartbeat period silences the very check that catches a hung round.',
    '  Start a round, end the turn, and let the heartbeat decide:',
    '  - receipt landed (the "missing" line the check prints for HEAD no longer names',
    '    cross-model-peer): run and record ce-code-review, push.',
    "  - VERDICT line present, receipt still missing, and that round's codex.exe (matched by its",
    '    prompt sentinel) is still running with the report mtime older than ~15 min: hung. Kill',
    '    that codex.exe and its pwsh child by PID only, never blanket; archive the report; re-run',
    '    the wrapper as the next round.',
    '  - VERDICT line present, receipt still missing, and no codex process carries the sentinel:',
    '    the wrapper already exited nonzero (FINDINGS without --acknowledge, dirty tree, HEAD',
    '    moved, no sentinel): refused, no receipt is coming. Read its stderr and the report, fix,',
    '    re-run.',
    '',
    'General rule this instantiates: any background worker, workflow, or e2e run gets a',
    'heartbeat armed at the same time it is started, and every wait is on an OBSERVABLE',
    'completion signal (a receipt, a file, an API status) rather than on a process returning.',
    '',
  ].join('\n');
}

const isDirectRun = process.argv[1]?.endsWith('session-start-context.mjs');
if (isDirectRun) process.stdout.write(heartbeatContract(projectRoot()));
