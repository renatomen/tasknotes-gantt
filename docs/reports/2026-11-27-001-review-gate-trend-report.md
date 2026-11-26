# Review-gate trend report — 2026-11-27

Rank 7 covers `scripts/cross-model-peer-review.sh` and `scripts/check-review-receipts.mjs`, as recorded in [the maintainability baseline](2026-08-15-001-maintainability-rediagnosis.md). This change adds per-commit authorship and an alternate reviewer route. Independence is judged when the peer review is recorded, and every non-deletion pushed ref tip is checked using its own receipt's family and author union.

## Shipping measurements

| File | Lines (`wc -l`) | Added vs origin/main | Deleted vs origin/main | Concerns |
|---|---:|---:|---:|---:|
| `scripts/cross-model-peer-review.sh` | 617 | 31 | 12 | 10 |
| `scripts/check-review-receipts.mjs` | 557 | 193 | 14 | 7 |

The wrapper has **21 distinct literal exit codes**, including success, and **45 literal nonzero exit sites**. Its codes are `0` and `2` through `21`. Unsupported peer selection and the pre-review author-union check use the existing unavailable-route status, `2`; the adapter adds no status code.

Line counts include comments and blank lines. Exit codes are distinct numeric literals following `exit`; refusal sites are occurrences of a literal nonzero `exit`, including multiple sites sharing a status. These are syntactic counts, not a count of every conditional path or helper-function return.

Reproduce the shipping figures from the repository root in Git Bash:

```bash
wc -l scripts/cross-model-peer-review.sh scripts/check-review-receipts.mjs
git diff --numstat origin/main -- scripts/cross-model-peer-review.sh
git diff --numstat origin/main -- scripts/check-review-receipts.mjs
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u
grep -oE '\bexit [0-9]+' scripts/cross-model-peer-review.sh | sort -u | wc -l
grep -oE '\bexit [1-9][0-9]*' scripts/cross-model-peer-review.sh | wc -l
```

## Concern inventory and growth reasons

The wrapper's **10 concerns** are argument parsing; preflight; Git and digest primitives; remote/upstream resolution; pre-review state guards; diff production and content guards; sentinel/canary checks; reviewer prompt; invocation and verdict parsing; record-time revalidation and receipt delegation. Reviewer selection stays inside the existing parsing, availability and invocation concerns. The author-union snapshot stays with the existing pre-review guards. Growth keeps both reviewer routes under the same guards and attests the author union of the exact review range, avoiding a second wrapper. Either supported family can review the other's work independently.

The receipts script's **7 concerns** are Git/store plumbing; pushed-ref parsing; archival-subject validation; receipt presence and accepted-findings evaluation; recording; CLI checking/reporting; per-commit declaration and peer-family policy. The added policy concern is a correctness requirement: this script owns the gate's independence decision. It stores additive declarations by commit SHA in `review-authors.json` under the Git common directory, so branch renames and linked worktrees preserve them. Both declaration commands serialize the entire read/merge/write under an exclusive lock, fail closed on lock timeout, and replace the store through a temporary file and atomic rename. This growth stays within Git/store plumbing and prevents lost declarations or partially written stores. The rewrite command copies declarations to new SHAs and unions families when commits are folded together. The wrapper's range query excludes commits reachable from the origin default branch, requires every remaining commit to be declared, and refuses a peer whose family occurs in their union. The recorder requires the attested family and union; push checks judge each tip's receipt without classifying refs. Branch, tag and raw-SHA pushes of the same commit receive the same verdict.

This is an explicit size and concern-count regression with a correctness reason, not a decomposition claim. Neither ranked script gains diagnostics or instrumentation. No source concern is relocated, no seam boundary changes, and no other ranked file changes. The gate-cluster deletion proposal remains outside this change's scope.
