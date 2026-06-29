---
title: "Issue-tracker housekeeping is bidirectional: sweep local docs for deferred work, park it in a backlog"
date: 2026-06-29
category: workflow-issues
module: project-tracking
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "running issue-tracker housekeeping (closing, refreshing, or triaging issues)"
  - "solo maintainer who closes completed work promptly, so few stale-open issues exist"
  - "plans/brainstorms ship brainstorm-to-plan-to-PR without ever filing a GitHub issue"
  - "deferred / out-of-scope / open-question sections strand future work in docs only"
  - "deciding whether postponed work should become GitHub issues now or a parked register"
tags:
  - issue-tracking
  - housekeeping
  - backlog
  - deferred-work
  - solo-maintainer
  - github-issues
  - project-management
---

# Issue-tracker housekeeping is bidirectional: sweep local docs for deferred work, park it in a backlog

## Context

A `/lfg` "housekeep GitHub issues" run on `tasknotes-gantt` — a solo-dev Obsidian plugin using the
compound-engineering brainstorm → plan → work flow — surfaced that an issue tracker accumulates **two**
kinds of drift, and they live in different places:

1. **Stale tracked items** — closed work whose epic checklists and cross-links have rotted, plus
   untriaged bugs. This drift lives *in* GitHub.
2. **Untracked deferred work** — intentionally-postponed work that never became an issue at all. This
   drift lives *outside* GitHub, stranded in the "Deferred to Follow-Up Work", "Out of scope", and
   "Open Questions" sections of `docs/plans/` and `docs/brainstorms/`.

The literal task — "close issues already resolved" — addressed only the first category and, for a
diligent solo maintainer, found nothing to close. The real value was elsewhere, and half of it was
invisible to anyone looking only at the tracker. A prior housekeeping pass had the same blind spot:
it cleaned legacy files out of `project/` and the `docs/` root but never swept the plan/brainstorm
docs for work that had never been promoted to an issue *(session history)*.

## Guidance

Treat tracker housekeeping as **bidirectional**.

**1. Tracked → cleaned.** Reconcile what's already in the tracker. Expect "close resolved issues" to
find little if the maintainer closes work promptly — **report that honest negative result instead of
manufacturing closures.** The real wins are surgical: refresh stale *hand-maintained* epic checklists
(closed children still showing unchecked boxes — note that auto-counting GitHub Milestones do **not**
have this rot, so trust them over the prose checklist), cross-link overlapping issues that came from
different epics, triage untriaged bugs. Touch only what needs it; leave tidy issues untouched rather
than adding noise comments.

**2. Untracked → captured.** Mine intentionally-deferred work from local docs. Then **curate hard
before recording**: dedupe against existing issues (don't refile tracked work), drop permanent
non-goals, and **verify each item against current code before filing** — shipped work hides in old
plans. This mirrors a verification discipline already proven here: an earlier session almost extracted
a "learning" doc that live code had already obsoleted, and caught it only by checking the code first
*(session history)*.

**3. For a solo dev, park untracked work in a doc-layer backlog, not premature GitHub issues.** A
single version-controlled `docs/backlog.md` beats N speculative issues. Each entry links its **source
plan** (full context one click away), carries a **priority tier**, and notes **where it would nest if
promoted**. Write the governing rule into both the file and `AGENTS.md`:

> **GitHub Issues = active work; backlog = parked work.** When you start a backlog item, `gh issue
> create` from its entry, then delete it from the backlog.

Add an `AGENTS.md` pointer so future sessions, other tools, and collaborators discover the register.

Frame the doc-vs-issues decision for the maintainer in product terms — a priority-tiered register and
a clear doc-only-vs-file recommendation — not as a mechanical dump.

## Why This Matters

- **Deferred work is invisible work.** If the only record of a postponed decision is buried in a
  shipped plan's "Out of scope" section, it will never resurface. A backlog makes intentional deferral
  durable and queryable.
- **A backlog beats residuals-in-PR-bodies.** A prior sweep recorded a PR's residuals into the merged
  PR body to make them "durable" — but that only works if someone re-reads that PR later; it is not a
  queryable register *(session history)*. The backlog file centralizes parked work where it can be
  grepped and groomed.
- **Premature issues are their own noise** for a solo dev — eight speculative tickets clutter the
  active-work view. A doc-layer register keeps active and parked work cleanly separated and
  version-controlled alongside the plans that spawned them.
- **Verify-before-file prevents zombie work items.** Old plans accumulate items that later shipped
  silently; filing them re-opens settled questions. This run caught a "unify dual build (esbuild → vite)"
  item that was already done and dropped it before filing.
- **Honest negative results are a feature.** Zero closures, reported plainly, is more trustworthy than
  churn-for-appearance.

## When to Apply

- Any tracker-housekeeping / "clean up the issues" / backlog-grooming request, especially on a solo or
  small-team repo.
- After a stretch of brainstorm → plan → PR work that shipped without filing issues — deferred items
  have likely accumulated in the plan docs.
- When deciding whether postponed work should become GitHub issues now vs. a parked register — default
  to the register for a solo dev.
- **Recognize tracker-only tasks.** Running a *code* pipeline (e.g. LFG: plan → work → code-review →
  browser-test → CI) on a tracker-only task means the code-review / browser-test / CI stages
  effectively no-op — the work product is GitHub state plus a versioned plan/backlog doc, not a repo
  diff. Don't expect code-diff gates to engage; the plan/backlog doc is the artifact to review.

## Examples

**Honest negative + surgical wins.** Of 10 open issues: 0 closed (none were actually resolved),
2 epic checklists refreshed (closed children re-checked), 2 issues cross-linked across epics, 1 bug
triaged — 5 touched, 5 deliberately left alone (PR #186).

**Backlog entry shape** (`docs/backlog.md`) — source-linked, tiered, with a promotion target:

```markdown
### P2 — Open render/index residuals (#161 tail)
- (a) U6 toolbar-search re-poke — unguarded bulk getValue() on search-clear.
      Source: docs/plans/2026-06-27-001-fix-view-option-render-churn-plan.md (U6)
- (b) Direct-frontmatter read to avoid bulk entry.getValue().
      Source: docs/plans/2026-06-28-002-fix-gantt-diff-sync-bulk-reseed-plan.md
Promote → nests under #161 follow-up. `gh issue create` when picked up, then delete this entry.
```

**Governing rule** (written into both `docs/backlog.md` and `AGENTS.md` "How we work"):

> GitHub Issues = active work; backlog = parked work. When you start a backlog item, `gh issue create`
> from its entry, then delete it from the backlog.

**Curation catch.** A mined "unify dual build (esbuild → vite)" item was verified against current code,
found already shipped (the repo is Vite-only now), and dropped before filing — verify before you file.

## Related

- `docs/backlog.md` — the live instance of this pattern (created in PR #186; "Last swept: 2026-06-29").
- `AGENTS.md` → "How we work" — where the active-vs-parked convention is codified for agents.
- `docs/solutions/tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md` — sibling
  residual-work discipline: that doc decides *whether to build* a deferred item (test-pyramid); this
  one decides *where to park* it (backlog vs. issue).
- Originating PR #186 (housekeeping); epics #53, #91; scheduling overlap #63 ↔ #88; triaged bug #183.
