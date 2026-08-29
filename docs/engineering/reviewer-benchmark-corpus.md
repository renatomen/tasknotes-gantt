# Reviewer benchmark corpus

The durable record E11 (`practices.md` § Repo divergences) accumulates. Each entry is one **adjudicated**
disagreement between two review passes over unchanged text.

**What this file is not.** It is a *disagreement log*, not the benchmark itself, and **rates cannot be computed from it**: it records only errors, with no denominator. Counting entries would rank a reviewer that ran a hundred times and missed twice below one that ran once and missed once. E11's benchmark is a fixed set of *known defects* that candidate reviewers are run against, scoring TP/FP/FN/TN and cost; this log's contribution is the **ground truth** — it is where adjudicated real defects and adjudicated reviewer errors are recorded, which is what such a set is assembled from. Building the set, and recording evaluation opportunities so a denominator exists, is still outstanding under E11.

**Why it exists as a file.** Review artifacts (`peer-review-*.md`) are gitignored and vanish with the working
tree. A rule that says "log it" without a logged location records nothing.

**Admission rule.** Only adjudicated cases. A disagreement is not ground truth: settle against the code which
pass was right, then record that. Never admit the raw disagreement.

## Fields

| Field | Meaning |
|---|---|
| `id` | `YYYY-MM-DD-NN` |
| `reviewer` | Which layer and model family produced the pass under judgement |
| `subject` | Commit SHA plus `file:line` of the disputed text |
| `pass-a` / `pass-b` | What each pass concluded |
| `kind` | `miss` (a clean verdict a later pass contradicted) or `false-alarm` (a finding a later check refuted) |
| `adjudication` | Which pass was right, and the source evidence that settled it |
| `outcome` | What changed as a result |

---

## 2026-08-30-01 — miss

- **reviewer:** cross-model peer layer (Codex CLI), round 7
- **subject:** `0198d18`, `docs/plans/2026-08-29-001-…-plan.md` U2 test scenarios and U3 unit
- **pass-a:** round 7 — `VERDICT: CLEAN`
- **pass-b:** round 8 — two P1s in that same text, unchanged between the passes
- **kind:** `miss`
- **adjudication:** pass-b correct, verified in source. `src/bases/cellRender.ts:150` builds each synthetic
  entry's `frontmatter` from the file-meta port, so U2's two-field list (`basename`, `extension`) omitted a
  load-bearing field; U3 carried only a prose promise of the characterization U1 stated it owed.
- **outcome:** `R5a` added — the adapter-characterization field list is derived from the adapter's output type
  rather than hand-maintained.

## 2026-08-30-02 — false alarm

- **reviewer:** cross-model peer layer (Codex CLI), round 5
- **subject:** `6f80a0f`, `docs/plans/2026-08-29-001-…-plan.md` U1 Verification
- **pass-a:** round 5 — P1: U1's Jest tests "call only the pure projection", so a same-typed swap of two flags
  and two colours escapes them
- **pass-b:** adjudication against source
- **kind:** `false-alarm` (on its stated premise)
- **adjudication:** premise refuted. U1's Approach step 2 moves `hasRecordedRecurringOccurrences`,
  `hasNonAuthoredEdgeInstance` and both `isSafeColor` scans **inside** the extracted module, so all four are
  produced by the projection and covered by its own tests. Recorded honestly: a *different* defect existed
  nearby — the legend e2e cannot discriminate any same-typed swap, since its fixture carries a recorded
  occurrence and a torn edge at once — but that was not this finding's stated ground.
- **outcome:** the false claim was deleted from U1's Verification; the genuine residual (host-side wiring) was
  closed separately under `R5a`.
