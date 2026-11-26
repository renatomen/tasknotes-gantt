# Review-gate trend report — 2026-11-27

Rank 7 covers `scripts/cross-model-peer-review.sh` and `scripts/check-review-receipts.mjs`, as recorded in [the maintainability baseline](2026-08-15-001-maintainability-rediagnosis.md). This change adds branch authorship and an alternate reviewer route. Independence is judged when the peer review is recorded, and each pushed commit is checked using its receipt's family and author set.

The comparison point is `origin/main` at `039427975f2ea2df6075ec272c973ecf7616e8f0`. The rework starts from `23d6180` (the earlier implementation); the registry retains its original branch anchor, `a8103b68621957e7d555cc8df081e1d520d75374`. The measurements below describe the modified working tree. The sandbox denies Git metadata writes, so implementation commits and their per-PR trend output cannot be recorded in this environment. The registry anchor identifies the available history, rather than claiming these edits are committed there.

## Measurements

| Metric | 2026-08-15 baseline | Before this change | Working tree | Change from before |
|---|---:|---:|---:|---:|
| Peer wrapper lines | 490 | 598 | 612 | +14 |
| Receipts script lines | 291 | 378 | 470 | +92 |
| Wrapper distinct literal exit codes, including success | 21 | 21 | 21 | 0 |
| Wrapper literal nonzero exit sites | approximately 39 | 43 | 45 | +2 |

The earlier implementation at `23d6180` measured 608 wrapper lines, 440 receipts-script lines and 44 refusal sites. This rework adds 4 wrapper lines, 30 receipts-script lines and one refusal site.

Line counts use `wc -l`, including comments and blank lines. Exit codes are distinct numeric literals following `exit`; refusal sites are occurrences of a literal nonzero `exit`, including multiple sites sharing a status. These are reproducible syntactic counts, not a count of every conditional path or helper-function return. The old report's approximate refusal count is retained as historical context, not asserted to use this exact convention.

Reproduce from the repository root in Git Bash:

```bash
wc -l scripts/cross-model-peer-review.sh scripts/check-review-receipts.mjs
git show origin/main:scripts/cross-model-peer-review.sh | wc -l
git show origin/main:scripts/check-review-receipts.mjs | wc -l
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u | wc -l
grep -oE '\bexit [1-9][0-9]*' scripts/cross-model-peer-review.sh | wc -l
git show origin/main:scripts/cross-model-peer-review.sh | grep -oE '\bexit [0-9]+' | sort -u | wc -l
git show origin/main:scripts/cross-model-peer-review.sh | grep -oE '\bexit [1-9][0-9]*' | wc -l
git show origin/main:maintainability-registry.json > .tmp-author-gate-base-registry.json
node scripts/maintainability-trend.mjs --base origin/main --head HEAD --registry .tmp-author-gate-base-registry.json --at-ceiling
```

The wrapper's distinct codes are `0` and `2` through `21`. Unsupported peer selection and the pre-review author-set check use the existing unavailable-route status, `2`; their two refusal sites explain the increase from 43 to 45. The adapter adds no status code.

The default trend invocation refuses the branch-side registry because its latest report's anchor, `a8103b686`, is newer than the `origin/main` measurement endpoint. Supplying the main-side registry snapshot succeeds, as the peer's trend staging does. It measures committed history through `23d6180`, showing 608 wrapper lines (+10) and 440 receipts-script lines (+62) relative to `origin/main`, and two ranked-file touches. The committed-tree complexity sweep reports 16 functions at the ceiling and 81 in the 11–15 pressure band. It cannot measure this uncommitted rework. The working-tree counts above and the normal lint gate cover the edited files directly; no working-tree at-ceiling count is claimed.

## Concern inventory and growth reasons

The wrapper retains the baseline's **10 concerns**: argument parsing; preflight; Git and digest primitives; remote/upstream resolution; pre-review state guards; diff production and content guards; sentinel/canary checks; reviewer prompt; invocation and verdict parsing; record-time revalidation and receipt delegation. Reviewer selection stays inside the existing parsing, availability and invocation concerns. Its fourteen-line growth keeps reviewer selection and the pre-review author-set snapshot in the same wrapper, avoiding duplicated guards. The improvement is that either supported family can independently review the other's work under the same guards.

The receipts script has **7 concerns**, versus **6 immediately before this change** and **5 in the original baseline**: Git/store plumbing; pushed-ref parsing; archival-subject validation; receipt presence and accepted-findings evaluation; recording; CLI checking/reporting; branch author declaration and peer-family policy. Archival validation already existed before this change. The new author policy adds one concern and 92 lines because this script owns receipt validation: it validates branch declarations before review, requires the wrapper to attest the family and author set, and checks every pushed commit against that recorded set without classifying refs. The same commit gets the same verdict through a branch, tag or raw-SHA push. Legacy peer receipts mean Codex reviewing Claude-authored work, and declarations stay in the local Git directory.

This is an explicit size and concern-count regression with a correctness reason, not a decomposition claim. Neither script gains diagnostics or instrumentation. No source concern is relocated, no seam boundary changes, and no other ranked file changes. The gate-cluster deletion proposal remains outside this change's scope.
