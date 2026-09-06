#!/usr/bin/env node
/**
 * SessionStart hook: emitted into every session's context before the first prompt.
 *
 * Exists because the heartbeat is an invariant, and AGENTS.md rules that an
 * invariant kept only by remembering it will eventually lose to momentum. This
 * repo lost roughly a working day to a peer-review wrapper that hung after
 * printing its verdict while the agent waited on it.
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
  const root = fromHook ?? execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  return root.split('\\').join('/');
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
    'contract: delete every job whose prompt starts with HEARTBEAT, then arm exactly one fresh',
    'recurring heartbeat with CronCreate, roughly every 5-8 minutes, whose prompt starts with',
    'HEARTBEAT and re-checks any in-flight work and ACTS on it rather than reporting it. Two',
    'heartbeats double every push and merge check. Arm it even if no background work exists',
    'yet: the moment you start any, the heartbeat must already be running. Do this before',
    'answering the first prompt, and never treat "I will check later" as a substitute.',
    '',
    `Every heartbeat command runs from the project root this session started in, ${root},`,
    'because the shell may be anywhere by the time the heartbeat fires. At minimum:',
    `  1. cd "${root}" && git status -sb && git log --oneline -1`,
    `  2. ${receiptCheckCommand(root)}`,
    '     (exit 0 means BOTH receipts are stamped for HEAD; otherwise its "missing" line',
    '     names the layers still unstamped)',
    '  3. from that root, gh pr view <n> --json headRefOid,mergeStateStatus,statusCheckRollup',
    '  4. count UNRESOLVED review threads via the reviewThreads GraphQL query',
    'and then: push if local is ahead with receipts green; merge only if headRefOid equals the',
    'local HEAD, CI is terminal-green, and zero threads are unresolved; otherwise say so in',
    'ONE line and stop.',
    '',
    'KNOWN FAILURE MODE, do not rediscover it:',
    '  scripts/cross-model-peer-review.sh HANGS AFTER printing its VERDICT and recording the',
    '  receipt. A finished review is indistinguishable from a running one by looking at the job.',
    '  The RECEIPT is the completion signal, never the wrapper returning. The wrapper stamps',
    '  only the cross-model-peer receipt, so the check stays nonzero until layer one is also',
    '  recorded: the peer is DONE when the "missing" line the check prints for HEAD no longer',
    '  names cross-model-peer. Then kill the stale job, run and record ce-code-review, and',
    '  push. Never block on the wrapper.',
    '',
    'General rule this instantiates: any background worker, workflow, or e2e run gets a',
    'heartbeat armed at the same time it is started, and every wait is on an OBSERVABLE',
    'completion signal (a receipt, a file, an API status) rather than on a process returning.',
    '',
  ].join('\n');
}

const isDirectRun = process.argv[1]?.endsWith('session-start-context.mjs');
if (isDirectRun) process.stdout.write(heartbeatContract(projectRoot()));
