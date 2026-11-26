# Review-gate trend report — 2026-11-27

Rank 7 covers `scripts/cross-model-peer-review.sh` and `scripts/check-review-receipts.mjs`, as recorded in [the maintainability baseline](2026-08-15-001-maintainability-rediagnosis.md). This change adds branch authorship and an alternate reviewer route. Independence is judged when the peer review is recorded, and each pushed commit is checked using its receipt's family and author set.

The comparison point is `origin/main` at `1cbe431abde1704ebdb33eb931bd637a8a0ed1db`. The measurements describe the final committed HEAD. The registry uses the main-side commit as the report anchor: trend reporting counts merged ranked-file changes after the anchor, so a branch-only anchor would make the normal CI command fail before this PR merges. The report-delivering merge is excluded from that count by the trend mechanism.

## Measurements

| Metric | 2026-08-15 baseline | Before this change | Committed HEAD | Change from before |
|---|---:|---:|---:|---:|
| Peer wrapper lines | 490 | 598 | 615 | +17 |
| Receipts script lines | 291 | 378 | 471 | +93 |
| Wrapper distinct literal exit codes, including success | 21 | 21 | 21 | 0 |
| Wrapper literal nonzero exit sites | approximately 39 | 43 | 45 | +2 |

Line counts use `wc -l`, including comments and blank lines. Exit codes are distinct numeric literals following `exit`; refusal sites are occurrences of a literal nonzero `exit`, including multiple sites sharing a status. These are reproducible syntactic counts, not a count of every conditional path or helper-function return. The old report's approximate refusal count is retained as historical context, not asserted to use this exact convention.

Reproduce from the repository root in Git Bash:

```bash
trend_base=1cbe431abde1704ebdb33eb931bd637a8a0ed1db
wc -l scripts/cross-model-peer-review.sh scripts/check-review-receipts.mjs
git diff --numstat origin/main...HEAD -- scripts/cross-model-peer-review.sh
git diff --numstat origin/main...HEAD -- scripts/check-review-receipts.mjs
git show "$trend_base":scripts/cross-model-peer-review.sh | wc -l
git show "$trend_base":scripts/check-review-receipts.mjs | wc -l
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u | wc -l
grep -oE '\bexit [1-9][0-9]*' scripts/cross-model-peer-review.sh | wc -l
git show "$trend_base":scripts/cross-model-peer-review.sh | grep -oE '\bexit [0-9]+' | sort -u | wc -l
git show "$trend_base":scripts/cross-model-peer-review.sh | grep -oE '\bexit [1-9][0-9]*' | wc -l
node scripts/maintainability-trend.mjs --base "$trend_base" --head HEAD --at-ceiling
```

The wrapper's distinct codes are `0` and `2` through `21`. Unsupported peer selection and the pre-review author-set check use the existing unavailable-route status, `2`; their two refusal sites explain the increase from 43 to 45. The adapter adds no status code.

The trend command succeeds against HEAD and measures two ranked-file touches: 615 wrapper lines (+17) and 471 receipts-script lines (+93). Per-PR growth against `origin/main` is +29/-12 for the wrapper and +104/-11 for the receipts script. Its `--at-ceiling` complexity sweep reports 16 functions at the ceiling and 81 in the 11–15 pressure band.

## Concern inventory and growth reasons

The wrapper retains the baseline's **10 concerns**: argument parsing; preflight; Git and digest primitives; remote/upstream resolution; pre-review state guards; diff production and content guards; sentinel/canary checks; reviewer prompt; invocation and verdict parsing; record-time revalidation and receipt delegation. Reviewer selection stays inside the existing parsing, availability and invocation concerns. Its seventeen-line growth keeps reviewer selection and the pre-review author-set snapshot in the same wrapper, avoiding duplicated guards. The improvement is that either supported family can independently review the other's work under the same guards.

The receipts script has **7 concerns**, versus **6 immediately before this change** and **5 in the original baseline**: Git/store plumbing; pushed-ref parsing; archival-subject validation; receipt presence and accepted-findings evaluation; recording; CLI checking/reporting; branch author declaration and peer-family policy. Archival validation already existed before this change. The new author policy adds one concern and 93 lines because this script owns receipt validation: it validates branch declarations before review, requires the wrapper to attest the family and author set, and checks every pushed commit against that recorded set without classifying refs. The same commit gets the same verdict through a branch, tag or raw-SHA push. Legacy peer receipts have neither family nor authors fields and mean Codex reviewing Claude-authored work; an author-bearing receipt without a reviewing family is refused. Declarations stay in the local Git directory.

This is an explicit size and concern-count regression with a correctness reason, not a decomposition claim. Neither script gains diagnostics or instrumentation. No source concern is relocated, no seam boundary changes, and no other ranked file changes. The gate-cluster deletion proposal remains outside this change's scope.
