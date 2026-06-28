---
title: "Match a perf/repro harness's execution model to the bug's actual trigger"
date: 2026-06-25
category: developer-experience
module: gantt-perf-harness
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - Investigating a freeze/hang/perf bug whose trigger is not yet confirmed
  - Designing a repro or perf-gate harness, before committing to its execution model
  - A harness runs green but the production bug still persists
tags:
  - perf-harness
  - repro
  - diagnosis
  - hypothesis-testing
  - static-vs-dynamic
  - render-performance
  - issue-161
  - instrument-design
---

# Match a perf/repro harness's execution model to the bug's actual trigger

## Context

Some bugs announce their trigger; "freeze"/hang/perf bugs usually don't. You see the symptom (a tab unresponsive for minutes) and a plausible story, but the actual *thing the user did* that set it off is unconfirmed. When you build a harness to reproduce or measure such a bug, you implicitly bake a trigger hypothesis into the harness's execution model — and it's tempting to build it around the single most salient hypothesis.

Concrete origin (#161, PR #162): a production "Gantt freeze" was hypothesized as a **static-render-scale** problem — a Show-all expansion exploding 261 matched tasks into ~2660 render instances. A two-layer perf harness was built around that hypothesis:

- **Isolated layer** — Vitest-browser component mount (`test/perf/`): mounts the real Gantt component in-memory at varying instance counts and measures render.
- **Full-stack layer** — WDIO against real Obsidian (`test/specs/gantt-perf-fullstack.perf.e2e.ts`): generates a vault, opens the `.base` **once**, and measures the static render.

Both layers share one execution model: **open the view once, measure the render.** That is exactly one trigger — static open at scale — and nothing else.

## Guidance

1. **Enumerate candidate triggers before you build.** For a freeze/perf bug the trigger is usually one of: static open/scale; a dynamic re-render loop (data update, filter change, search clear, view-setting toggle firing repeated re-renders); user interaction (drag/scroll/zoom); or external events. Pick the one you're testing and build the harness to exercise *that*. Then **write down explicitly what the harness does NOT exercise**, next to the harness.
2. **Read a passing harness as evidence, not just a gate.** A green static-scale harness *at or above* production scale does more than reassure — it **disproves** "this is a static-render-scale freeze." A clean run is a navigational signal pointing at where *not* to look.
3. **Keep distinct failure modes distinct.** One instrument's green says nothing about a different trigger. #161 carried two hypotheses — a static-render scale problem (P2) and a dynamic resultset-change re-render loop (P1). Measuring the static layer says nothing about the loop; don't let one green imply the whole bug is solved.
4. **Build the durable instrument anyway.** Even when it doesn't catch the bug, a scale harness has real regression value — it pins the layer it covers so future work can't silently regress it. Just read its verdict precisely: "this layer is clean," not "the bug is gone."

## Why This Matters

A harness aimed at the wrong trigger produces a **true-but-irrelevant green**: the measurement is correct, but it answers a question you weren't asking. Misread as "no bug," it wastes effort hardening an already-healthy path or, worse, prematurely closes an investigation while the real freeze ships to users.

Framing the harness as a *disprover* flips a clean run from a dead end into direction. In #161 the matured harness ran clean at the true production point — 10k notes / 5k tasks / 261 matched / Show-all: cold index ~69s, **render ~7.7s**, virtualization holding a ~15-row materialized window; the isolated in-memory layer measured ~520ms at 3,332 instances. None of that is a freeze. That green is exactly what **redirected the hunt** from "tame the instance explosion" (P2, static) to "fix the dynamic resultset-change re-render loop" (P1, on branch `fix/resultset-render-loop`) — a trigger a one-shot static base-open structurally *cannot* exercise.

## When to Apply

- Investigating any freeze/hang/perf bug whose **trigger is not yet confirmed**.
- Designing a repro or perf-gate harness — before committing to its execution model, enumerate triggers and choose deliberately.
- When **a harness is green but the production bug persists** — treat that as a strong signal the harness exercises the wrong trigger, and switch the hunt to the triggers it can't see rather than re-running it.

## Examples

**The contrast that defines the lesson:**

- *Static-open harness (what was built):* generate vault → `openFile(base)` **once** → wait out cold index → measure `.wx-bar` materialization and the virtualization window. Exercised the static-render-scale trigger exhaustively, up to 10k/5k/261 Show-all. Verdict: render ~7.7s, virtualization holds — **clean**.
- *What it structurally cannot see:* a re-render **loop** driven by `onDataUpdated` / filter-change / search-clear / view-setting toggle, where the view re-renders repeatedly in response to resultset changes. No amount of one-shot static base-opening fires this path.

**Worked example (#161):** static render was fine at full production scale (~7.7s, virtualization holding) while the dynamic resultset loop went entirely unmeasured by either layer. The clean static result is what told the team the freeze lived in the dynamic path (P1), not the instance explosion (P2) — converting a passing perf harness into a map of where the bug *wasn't*.

**In one line:** match the harness's execution model to the *actual* trigger, and when it passes, ask "what did this just disprove?" — not "are we done?"

## Related

- [gate-e2e-on-cold-index-before-measuring-render.md](./gate-e2e-on-cold-index-before-measuring-render.md) — sibling from the same #161/PR #162 harness work, different failure mode: that one is a false *failure* (a still-indexing wait masquerades as a freeze — measurement contamination); this one is a false *pass* (a clean run on a trigger the harness can't even exercise). Two ways the same instrument can mislead.
- [gantt-theme-toggle-bases-refresh-loop.md](../integration-issues/gantt-theme-toggle-bases-refresh-loop.md) — a concrete *dynamic* `config.set → onDataUpdated → refresh` re-render loop: the exact failure class this learning redirects #161 toward, and which a static base-open cannot reach.
- [svar-gantt-diff-sync-interactions.md](../integration-issues/svar-gantt-diff-sync-interactions.md) — the diff-sync / `onDataUpdated` reseed architecture the dynamic resultset-change path runs through — what a harness must drive to reproduce the P1 loop.
- [test-at-the-fastest-level-not-redundant-e2e.md](../tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md) — same methodological family: pick the level that actually exercises the behavior; hard-to-trigger is a design signal.
- [headless-e2e-verification-for-ui-work.md](./headless-e2e-verification-for-ui-work.md) — harness baseline; a passing headless run only proves what its execution model actually triggered.
- GitHub `#161` (open) — "Infinite render loop on resultset change (search clear, filter change, view-setting toggle)": the dynamic P1 trigger this redirected toward. `#162` — the perf-harness PR. `#98` — the async-indexing sibling cited in the cold-index doc's family.
