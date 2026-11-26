# Review-gate trend report — 2026-11-27

Rank 7 covers `scripts/cross-model-peer-review.sh` and `scripts/check-review-receipts.mjs`, as recorded in [the maintainability baseline](2026-08-15-001-maintainability-rediagnosis.md). This change adds branch authorship and an alternate reviewer route so independence is checked by the gate.

The comparison point is `origin/main` at `039427975f2ea2df6075ec272c973ecf7616e8f0`. The available branch anchor is `a8103b68621957e7d555cc8df081e1d520d75374`; the measurements below describe the modified working tree. The sandbox denies Git metadata writes, so implementation commits and their per-PR trend output cannot be recorded in this environment. The registry anchor identifies the available history, rather than claiming these edits are committed there.

## Measurements

| Metric | 2026-08-15 baseline | Before this change | Working tree | Change from before |
|---|---:|---:|---:|---:|
| Peer wrapper lines | 490 | 598 | 608 | +10 |
| Receipts script lines | 291 | 378 | 440 | +62 |
| Wrapper distinct literal exit codes, including success | 21 | 21 | 21 | 0 |
| Wrapper literal nonzero exit sites | approximately 39 | 43 | 44 | +1 |

Line counts use `wc -l`, including comments and blank lines. Exit codes are distinct numeric literals following `exit`; refusal sites are occurrences of a literal nonzero `exit`, including multiple sites sharing a status. These are reproducible syntactic counts, not a count of every conditional path or helper-function return. The old report's approximate refusal count is retained as historical context, not asserted to use this exact convention.

Commands run from the repository root in Git Bash:

```bash
wc -l scripts/cross-model-peer-review.sh scripts/check-review-receipts.mjs
git show origin/main:scripts/cross-model-peer-review.sh | wc -l
git show origin/main:scripts/check-review-receipts.mjs | wc -l
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u | wc -l
grep -oE '\bexit [1-9][0-9]*' scripts/cross-model-peer-review.sh | wc -l
git show origin/main:scripts/cross-model-peer-review.sh | grep -oE '\bexit [0-9]+' | sort -u | wc -l
git show origin/main:scripts/cross-model-peer-review.sh | grep -oE '\bexit [1-9][0-9]*' | wc -l
node scripts/maintainability-trend.mjs --base origin/main --head HEAD --at-ceiling
```

The wrapper's distinct codes are `0` and `2` through `21`. Unsupported peer selection uses the existing unavailable-route status, `2`; its one new refusal site explains the increase from 43 to 44. The adapter adds no status code.

The trend command succeeds for committed history, showing the pre-change sizes, 598 and 378, and zero ranked-file touches between `origin/main` and the available branch anchor. It cannot measure uncommitted edits; its automatic complexity sweep is therefore not triggered. The working-tree counts above and the normal lint gate cover the edited files directly. No repository-wide at-ceiling count is claimed here.

## Concern inventory and growth reasons

The wrapper retains the baseline's **10 concerns**: argument parsing; preflight; Git and digest primitives; remote/upstream resolution; pre-review state guards; diff production and content guards; sentinel/canary checks; reviewer prompt; invocation and verdict parsing; record-time revalidation and receipt delegation. Reviewer selection stays inside the existing parsing, availability and invocation concerns. Its ten-line growth avoids a second wrapper duplicating every guard. The improvement is that either supported family can independently review the other's work under the same guards.

The receipts script has **7 concerns**, versus **6 immediately before this change** and **5 in the original baseline**: Git/store plumbing; pushed-ref parsing; archival-subject validation; receipt presence and accepted-findings evaluation; recording; CLI checking/reporting; branch author declaration and peer-family policy. Archival validation already existed before this change. The new author policy adds one concern and 62 lines because this script owns the push decision: it now refuses undeclared and same-family authorship, including when two pushed local branches share a commit. Legacy peer receipts retain their Codex identity, and declarations stay in the local Git directory.

This is an explicit size and concern-count regression with a correctness reason, not a decomposition claim. Neither script gains diagnostics or instrumentation. No source concern is relocated, no seam boundary changes, and no other ranked file changes. The gate-cluster deletion proposal remains outside this change's scope.
