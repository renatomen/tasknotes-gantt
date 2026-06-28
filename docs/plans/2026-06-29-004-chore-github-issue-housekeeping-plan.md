---
title: "chore: GitHub issue housekeeping — close resolved, refresh stale, cross-link, triage"
type: chore
status: active
date: 2026-06-29
depth: standard
origin: none (direct LFG invocation)
target_repo: renatomen/tasknotes-gantt
---

# chore: GitHub Issue Housekeeping

## Summary

Audit every **open** issue on `renatomen/tasknotes-gantt`, verify each against the current
codebase and PR history, and bring the tracker to a tidy, accurate state: close anything
already resolved, refresh anything the project has outgrown, cross-link overlapping work,
and triage the one untriaged bug.

This is a **tracker-state** chore, not a code change. The work is executed through `gh`
(`gh issue edit`, `gh issue comment`); **no source files change by design.** The durable
repo artifact is this plan plus the resulting issue state.

**Headline finding (verified):** there are **no open issues that are already resolved**.
The maintainer closes completed units promptly — every finished child issue (#54–#61,
#81–#85, #93, #95, #98, …) is already closed. So the "close resolved issues" objective
yields **zero closures**; that is an honest outcome of the audit, not a skipped step. The
real housekeeping debt is: two epic bodies with stale hand-maintained checklists, two
scheduling issues describing overlapping engines with no cross-link, and one new bug that
is correctly labelled but undocumented as to root cause.

---

## Problem Frame

The tracker has 10 open issues. Hand-maintained epic checklists and parallel requirement
docs have drifted from reality:

1. **Epic #53** (TaskNotes-companion repositioning) lists children #54–#63 with **every box
   unchecked**, yet Milestones M0/M1/M2 (#54–#61) are **all closed**. A reader scanning the
   epic cannot tell what is done.
2. **Epic #91** (RFC 9253 dependency types) lists M1 (#81, #82) and M2 (#83, #84, #85) with
   **unchecked boxes**, yet all five are **closed**. Same drift.
3. **#63 (U10 SchedulingEngine, Tier 1)** and **#88 (M4 reltype+gap-aware engine)** come from
   two different requirement docs and describe **overlapping scheduling engines** with no
   cross-reference — a double-build / scope-collision risk.
4. **#183** (CDN stylesheet CSP violation) is a valid, reproducible bug, correctly labelled
   `bug`, but has **no triage note** recording the root-cause area.

GitHub Milestones themselves are accurate (they auto-count open/closed) — the drift is only
in the **manually authored issue bodies** and in **missing cross-links**.

---

## Scope Boundaries

**In scope** (tracker mutations only):
- Refreshing the two stale epic bodies (#53, #91) to reflect closed children.
- Cross-linking the two overlapping scheduling issues (#63 ↔ #88).
- Correcting one stale wording reference in #88.
- Adding a root-cause triage note to bug #183.
- Confirming the remaining open issues are tidy and accurate (verify-only, no edit).

**Out of scope:**
- **Fixing the #183 CSP bug in code** — triage only; the fix is separate engineering work.
- **Closing #63 or #88 as duplicates** — they overlap but are not strict duplicates
  (#63 = parent roll-up + basic cascade, Tier 1; #88 = RFC 9253 reltype+gap-aware cascade).
  Consolidation is a maintainer decision; the conservative, reversible move is to cross-link
  and surface the overlap, not unilaterally close.
- **Opening new issues** — no new work is created by this chore.
- **Editing closed issues** or GitHub Milestones (already accurate).

### Deferred to Follow-Up Work
- Code fix for #183 (CDN `wx-icons.css` stylesheet still requested despite `<Willow fonts={false}>`).
- A maintainer decision on whether to merge #63's cascade scope into #88 / the #91 epic.

---

## Verified Audit Table (source of truth for the units)

All states verified 2026-06-29 via `gh` and codebase grep.

| Issue | Title | Verified state | Decision | Action |
|------:|-------|----------------|----------|--------|
| #53  | Epic: TaskNotes-first companion | M0/M1/M2 children (#54–#61) **all closed**; only #62, #63 open. Body all `[ ]`. | **Update body** | Check completed boxes; mark M0/M1/M2 done; state remaining = M3 #62, M4 #63. |
| #62  | U9: Obsidian commands + JS API | Not implemented (no `addCommand` in `src/`). Scope accurate. | **Keep — no edit** | Tidy & relevant. |
| #63  | U10: SchedulingEngine roll-up + cascade | Not implemented (`src/scheduling` absent). **Overlaps #88.** | **Update (cross-link)** | Comment cross-referencing #88/#91; note Tier-1 vs reltype-aware relationship. |
| #86  | M3: Create FF/SS/SF dependencies | Blocked by upstream `renatomen/tasknotes#10` — **still OPEN**. | **Keep — no edit** | Blocker accurate; correctly gated. |
| #87  | M3: Edit link reltype + gap | Same upstream blocker (open). | **Keep — no edit** | Blocker accurate. |
| #88  | M4: reltype+gap-aware engine (pure) | Not implemented. **Overlaps #63.** Wording "fill `src/scheduling` (currently empty placeholder)" is stale — dir does not exist. | **Update (cross-link + wording)** | Cross-ref #63; correct placeholder wording. |
| #89  | M4: Wire cascade to drag/resize | Not implemented. Scope accurate. | **Keep — no edit** | Tidy. |
| #90  | M4: Manual-drag violation handling | Not implemented. Scope accurate. | **Keep — no edit** | Tidy. |
| #91  | Epic: RFC 9253 dependency types | M1 (#81, #82) + M2 (#83, #84, #85) **closed**; body `[ ]`. UT `tasknotes#10` still open. | **Update body** | Check M1/M2 boxes; confirm M3 blocked (UT open), M4 pending. |
| #183 | CSP: CDN stylesheet refused | Valid bug. Code uses `<Willow fonts={false}>` (`GanttContainer.svelte`) yet SVAR still requests `https://cdn.svar.dev/fonts/wxi/wx-icons.css`. Labelled `bug`. | **Keep + triage note** | Add root-cause triage comment; confirm label. No code fix here. |

**Net:** 0 closed · 5 issues edited (#53, #63, #88, #91, #183) · 4 confirmed-tidy untouched
(#62, #86, #87, #89, #90 — verify-only, no noise comments).

---

## Key Technical Decisions

- **KTD-1 — No closures.** The audit found no already-resolved open issue. Record this
  explicitly rather than manufacturing a closure. (Closing a genuinely-open issue to satisfy
  the prompt would be worse than leaving an honest "nothing to close" result.)
- **KTD-2 — Surgical edits only.** Touch the 5 issues that have real drift/overlap/bug-triage
  debt. Do **not** post confirmation comments on the 4 already-tidy issues — comment noise is
  itself a tidiness regression.
- **KTD-3 — Cross-link, don't merge, the scheduling overlap.** #63 and #88 overlap but are not
  identical. Cross-linking is reversible and preserves both requirement traces; closing one as
  a dup is a destructive maintainer-level call left for follow-up.
- **KTD-4 — Triage #183, don't fix it.** Housekeeping records the root-cause area so the bug is
  actionable; the actual CSP/CDN fix is engineering work outside this chore's scope.
- **KTD-5 — Preserve epic checklist structure.** When updating #53/#91 bodies, only toggle
  `[ ]`→`[x]` for closed children and add a short "as of 2026-06-29" status line. Do not
  restructure milestones or rewrite scope prose (the Milestones already track counts).

---

## Implementation Units

### U1. Refresh epic #53 body — reflect completed milestones

**Goal:** Make the TaskNotes-companion epic accurately show M0/M1/M2 complete and M3/M4 remaining.
**Decision:** Update.
**Approach:**
- Fetch current body (`gh issue view 53 --json body`).
- Toggle `[ ]`→`[x]` for #54, #55 (M0); #56, #57, #58, #59, #60 (M1); #61 (M2) — all verified closed.
- Add a dated status line under the milestone list, e.g.
  `> Status (2026-06-29): M0–M2 complete; remaining work: M3 (#62), M4 (#63).`
- Leave #62, #63 unchecked. Do not alter scope-boundary prose.
- Write via `gh issue edit 53 --body-file <tmp>`.
**Files:** none (tracker mutation).
**Patterns to follow:** Mirror the existing checklist/milestone formatting already in the body.
**Test expectation:** none — tracker mutation. **Verification:** re-run `gh issue view 53`;
confirm the 8 completed children render `[x]` and the status line is present; #62/#63 remain `[ ]`.

### U2. Refresh epic #91 body — check M1/M2, confirm blocker status

**Goal:** Show RFC 9253 epic's M1 + M2 complete and the M3 upstream blocker still active.
**Decision:** Update.
**Dependencies:** none.
**Approach:**
- Fetch body (`gh issue view 91`).
- Toggle `[ ]`→`[x]` for #81, #82 (M1) and #83, #84, #85 (M2) — verified closed.
- Append a dated status line:
  `> Status (2026-06-29): M1–M2 complete. M3 (#86, #87) blocked by renatomen/tasknotes#10 (open). M4 (#88–#90) pending.`
- Leave #86–#90 unchecked. Keep the existing Cross-repo UT line.
- Write via `gh issue edit 91 --body-file <tmp>`.
**Files:** none.
**Patterns to follow:** existing milestone block in #91.
**Test expectation:** none. **Verification:** `gh issue view 91`; the 5 completed children
render `[x]`; status line present; UT/M3/M4 items remain `[ ]`.

### U3. Cross-link overlapping scheduling issues #63 ↔ #88

**Goal:** Prevent double-build and surface the scope overlap between the two scheduling engines.
**Decision:** Update (comments on both).
**Dependencies:** none.
**Approach:**
- Comment on **#63**: note that #88 (epic #91, M4) covers the reltype+gap-aware dependency
  cascade; #63 remains the Tier-1 roll-up + basic parent/dependency cascade. Flag for maintainer:
  consider whether #63's dependency-cascade portion should fold into #88 (decision deferred).
- Comment on **#88**: reciprocal cross-link to #63; note both target the (absent) scheduling
  engine and should share one `src/scheduling` implementation when built.
- Use `gh issue comment 63 --body-file <tmp>` / `gh issue comment 88 --body-file <tmp>`.
**Files:** none.
**Test expectation:** none. **Verification:** both issues show the cross-link comment referencing
the other; neither is closed.

### U4. Correct stale wording in #88

**Goal:** Fix the inaccurate "currently empty placeholder" reference (the `src/scheduling`
directory does not exist at all).
**Decision:** Update (body edit, folded with U3's context).
**Dependencies:** U3 (same issue; do body edit + cross-link comment in one pass to avoid churn).
**Approach:**
- In #88 body, change "Fill `src/scheduling` (currently empty placeholder)" →
  "Create `src/scheduling` (does not yet exist)".
- `gh issue edit 88 --body-file <tmp>`.
**Files:** none.
**Test expectation:** none. **Verification:** `gh issue view 88` body no longer claims an empty
placeholder exists.

### U5. Triage bug #183 — record root-cause area

**Goal:** Make the CSP/CDN stylesheet bug actionable with a documented root cause; confirm labels.
**Decision:** Keep open + triage comment.
**Dependencies:** none.
**Approach:**
- Verify label `bug` present (it is); add no further label unless a `dependencies`/`enhancement`
  mismatch is found.
- Comment with the verified root-cause area: the SVAR Willow theme still emits a
  `<link>`/`@import` to `https://cdn.svar.dev/fonts/wxi/wx-icons.css` even though
  `GanttContainer.svelte` mounts `<Willow fonts={false}>`; the plugin already substitutes
  Lucide glyphs for `wxi-*` icons, so the CDN stylesheet is unnecessary and should be prevented
  from loading (CSP forbids it). Note that the **fix is deferred** (separate engineering task).
- `gh issue comment 183 --body-file <tmp>`.
**Files:** none.
**Test expectation:** none — triage, not a fix. **Verification:** #183 shows the triage comment;
`bug` label confirmed; issue remains open.

### U6. Confirm tidy issues need no edit (verify-only)

**Goal:** Positively confirm #62, #86, #87, #89, #90 are accurate and relevant; make **no** edits.
**Decision:** Keep — no edit.
**Dependencies:** none.
**Approach:**
- Re-confirm: #62 (U9) unimplemented and accurately scoped; #86/#87 correctly gated on
  upstream `tasknotes#10` (still open); #89/#90 accurately scoped, not started.
- Record the confirmation in the final housekeeping summary (chat / PR body), **not** as issue
  comments — avoid noise (KTD-2).
**Files:** none.
**Test expectation:** none. **Verification:** these five issues are unchanged after the run
(no new comments, no body edits).

---

## Risks & Mitigations

- **Risk: comment/edit noise reduces tidiness.** Mitigation: KTD-2 — only the 5 debt-bearing
  issues are touched; tidy issues get no comments.
- **Risk: an `gh issue edit --body` overwrites unrelated body content.** Mitigation: always
  fetch the current body first, edit it in a temp file, and diff before writing; only toggle
  checkboxes / append status lines.
- **Risk: incorrectly closing a still-open issue.** Mitigation: KTD-1 — zero closures this run;
  no issue is closed.
- **Risk: pipeline gate expects source-file changes.** Mitigation: documented as a tracker-only
  chore; the plan doc is the repo artifact and downstream code-review/browser-test steps are
  expected to no-op.

---

## Verification (whole chore)

After execution, re-run the audit and confirm:
1. `gh issue view 53` and `gh issue view 91` — completed children render `[x]`; dated status lines present.
2. `gh issue view 63` / `88` — reciprocal cross-link comments present; #88 body wording corrected.
3. `gh issue view 183` — triage comment present; `bug` label confirmed; still open.
4. `gh issue list --state open` — still 10 open (no accidental closures), each now tidy/relevant.
5. `gh issue view 62 / 86 / 87 / 89 / 90` — unchanged (no new comments).
