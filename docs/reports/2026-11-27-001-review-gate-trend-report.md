# Review-gate trend report — 2026-11-27

Rank 7 covers `scripts/cross-model-peer-review.sh` and `scripts/check-review-receipts.mjs`, as recorded in [the maintainability baseline](2026-08-15-001-maintainability-rediagnosis.md). The peer command requires an assertion of the reviewed range's authoring families and can select either reviewer family. Independence is checked before review and when the receipt is recorded; every non-deletion pushed ref tip is checked using its own receipt's family and authors.

## Shipping measurements

| File | Lines (`wc -l`) | Added vs origin/main | Deleted vs origin/main | Concerns |
|---|---:|---:|---:|---:|
| `scripts/cross-model-peer-review.sh` | 636 | 54 | 16 | 10 |
| `scripts/check-review-receipts.mjs` | 428 | 64 | 14 | 6 |

Rank 7's combined net growth against origin/main is **88 lines**: 38 in the wrapper and 50 in the receipts script. Removing persistent declarations reduces the earlier design's 198-line growth by **110 lines**.

The wrapper has **21 distinct literal exit codes**, including success, and **46 literal nonzero exit sites**. Its codes are `0` and `2` through `21`. Unsupported peer selection and the required author assertion use the existing unavailable-route status, `2`; base-rubric staging uses the existing staging status, `21`. Neither adds a status code.

Line counts include comments and blank lines. Exit counts exclude full comment lines: codes are distinct numeric literals following `exit`; refusal sites are occurrences of a literal nonzero `exit`, including multiple sites sharing a status. These are syntactic counts, not a count of every conditional path or helper-function return.

Reproduce the shipping figures from the repository root in Git Bash:

```bash
wc -l scripts/cross-model-peer-review.sh scripts/check-review-receipts.mjs
git diff --numstat origin/main -- scripts/cross-model-peer-review.sh
git diff --numstat origin/main -- scripts/check-review-receipts.mjs
grep -vE '^[[:space:]]*#' scripts/cross-model-peer-review.sh | grep -oE '\bexit [0-9]+' | sort -u
grep -vE '^[[:space:]]*#' scripts/cross-model-peer-review.sh | grep -oE '\bexit [0-9]+' | sort -u | wc -l
grep -vE '^[[:space:]]*#' scripts/cross-model-peer-review.sh | grep -oE '\bexit [1-9][0-9]*' | wc -l
```

## Concern inventory and growth reasons

The wrapper's **10 concerns** are argument parsing; preflight; Git and digest primitives; remote/upstream resolution; pre-review state guards; diff production and content guards; sentinel/canary checks; reviewer prompt; invocation and verdict parsing; record-time revalidation and receipt delegation. Reviewer selection and author assertions stay inside the existing parsing, preflight and invocation concerns. Base-rubric staging supplies the existing reviewer prompt with the rules at the main merge-base used by the trend block, including on follow-up reviews. Codex disables automatic project instructions so the branch's rubric cannot override the main-side one. Growth keeps both reviewer routes under the same guards and attests the authors of the exact review range, avoiding a second wrapper. Either supported family can review the other's work independently.

The receipts script's **6 concerns** are Git/store plumbing; pushed-ref parsing; archival-subject validation; receipt presence, accepted-findings and independence evaluation; recording; CLI checking/reporting. Growth makes the gate's independence claim hold when either family authors code: the recorder requires attested authors and a different reviewing family, and push checks judge each tip's receipt without classifying refs. Branch, tag and raw-SHA pushes of the same commit receive the same verdict. Removing declaration persistence eliminates its separate policy concern, locks, atomic writes, rewrite handling and default-branch resolution. Authorship is asserted anew for each review and retained only in that review's receipt; ordinary Git operations carry no declaration state to maintain.

Both scripts grow against origin/main for the correctness reasons above; neither gains a separable concern. Removing declaration state reduces the receipts script's concern count from seven to six and removes failure paths for ordinary Git operations. Neither ranked script gains diagnostics or instrumentation. No source concern is relocated, no seam boundary changes, and no other ranked file changes. The gate-cluster deletion proposal remains outside this change's scope.
