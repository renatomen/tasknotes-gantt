#!/usr/bin/env node
/**
 * SessionStart hook: emitted into every session's context before the first prompt.
 *
 * Exists because the heartbeat is an invariant, and AGENTS.md rules that an
 * invariant kept only by remembering it will eventually lose to momentum. This
 * repo lost roughly a working day to a peer-review wrapper that hung after
 * printing its verdict while the agent waited on it.
 */
process.stdout.write(
  [
    'HEARTBEAT CONTRACT (session-start hook, non-negotiable):',
    '',
    'Before doing anything else in this session, arm a recurring heartbeat with CronCreate,',
    'roughly every 5-8 minutes, whose prompt re-checks any in-flight work and ACTS on it',
    'rather than reporting it. Arm it even if no background work exists yet: the moment you',
    'start any, the heartbeat must already be running. Do this before answering the first',
    'prompt, and never treat "I will check later" as a substitute.',
    '',
    'The heartbeat prompt must, at minimum:',
    '  1. git status -sb and git log --oneline -1',
    '  2. node scripts/check-review-receipts.mjs check   (exit 0 means BOTH receipts are stamped)',
    '  3. gh pr view <n> --json headRefOid,mergeStateStatus,statusCheckRollup',
    '  4. count UNRESOLVED review threads via the reviewThreads GraphQL query',
    'and then: push if local is ahead with receipts green; merge if CI is terminal-green with',
    'zero unresolved threads; otherwise say so in ONE line and stop.',
    '',
    'KNOWN FAILURE MODE, do not rediscover it:',
    '  scripts/cross-model-peer-review.sh HANGS AFTER printing its VERDICT and recording the',
    '  receipt. A finished review is indistinguishable from a running one by looking at the job.',
    '  The RECEIPT is the completion signal, never the wrapper returning. If',
    '  check-review-receipts reports OK for the current HEAD, the peer is DONE: kill the stale',
    '  job, record ce-code-review, and push. Never block on the wrapper.',
    '',
    'General rule this instantiates: any background worker, workflow, or e2e run gets a',
    'heartbeat armed at the same time it is started, and every wait is on an OBSERVABLE',
    'completion signal (a receipt, a file, an API status) rather than on a process returning.',
    '',
  ].join('\n'),
);
