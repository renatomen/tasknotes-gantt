---
date: 2026-06-28
topic: gantt-readiness-recheck
---

# Gantt enrichment-cache readiness re-check — requirements

## Summary

After the Gantt view mounts, treat the TaskNotes enrichment cache as **provisional** and re-fetch the relationship index on a bounded, backed-off schedule until relationships resolve (or a small attempt cap is reached), then go dormant. This heals Show-all expansion (and Inherit parent-nesting) when TaskNotes' relationship index warms *after* the first build, completing the long-dormant U7 reactivity seam. PR #166 remains the foundation; this closes the relationship-lag gap on top of it.

## Problem Frame

Show-all can render at the matched-only count and never recover. The Gantt controller caches the TaskNotes relationship index and re-fetches it only when `enrichmentDirty` flips (a TaskNotes `task.*` event or an availability flip). Two cold-start conditions defeat that:

1. **Fully cold** — `tasks.list()` (a just-in-time scan over Obsidian's `metadataCache`) is empty at mount, so the index is empty. *Addressed by PR #166*: the source now returns `null` for not-ready, and the controller no longer caches it.
2. **Relationship-lag** — `tasks.list()` is already warm (≥1 task) but relationship resolution **lags behind file resolution**. The perf E2E confirms this: `subtasks()`/`parents()` can still be empty after every markdown file is indexed *and* after `lifecycle.ready()` resolves (`test/specs/gantt-perf-fullstack.perf.e2e.ts:259-262`). PR #166 treats a tasks-warm index as authoritative and caches it — so an index captured during the lag window is cached with empty relationships and never heals.

There is no reliable self-heal because, on a warm restart, Obsidian loads its persisted `metadataCache` **without firing per-file `changed` events** — so TaskNotes emits no `task.*` event, `enrichmentDirty` never flips, and the empty-relationship index persists until the user manually edits a task. There is also no TaskNotes "relationships ready" event to subscribe to; the only known signal is to read again and observe whether edges have appeared (the perf harness polls for exactly this).

Documented as issue #161 §11 ("Show all renders empty until indexed").

## Key Decisions

- **Bounded re-check window, not an unbounded poll.** Inferring readiness from data emptiness is impossible (an empty `childrenByPath` is ambiguous: not-ready vs genuinely no edges). So the heal is a *bounded* re-fetch window that runs after mount and then goes dormant, rather than re-fetching whenever the index looks empty. This protects the #161 perf budget — a no-relationships vault must never re-scan the full vault on every Bases notify.

- **Count + exponential backoff.** The hard bound is a small fixed number of attempts with exponential backoff (order ~5 attempts over ~10–15s), driven by a view-owned scheduler. Chosen over a wall-clock deadline for deterministic testability ("runs N times then stops forever"). The simpler single-delayed-re-check alternative is *not* rejected on assertion alone: planning must measure the typical/p99 relationship-lag in the perf harness — if one short delay reliably covers it, prefer that and drop the backoff machinery. Count+backoff is the safe default until that measurement exists.

- **Early-stop on a positive *matched-set* signal only — never on emptiness.** Each re-check rebuilds the full-vault index, but the bug is under-expansion of the *matched* set and relationships warm incrementally — so a global "any edge in `childrenByPath`" check can stop while the matched parents are still cold. Stop early **only** when at least one currently-matched parent has resolved children. A "content-stable across two attempts" signal is deliberately rejected: an idle warming index is trivially stable (identical empty/partial maps across two close attempts land in a warmup lull), which would false-stop mid-warmup and leave Show-all permanently under-expanded — the exact failure this work targets. The attempt cap is the **sole** backstop for the case where matched parents never resolve children.

- **Window starts at mount and subsumes the "mounted-after-resolved" case.** Because the window is anchored to mount (not to a one-shot event), a view mounted *after* the cache is already warm gets an authoritative index on attempt 1 and stops immediately — zero extra cost, no "did resolved already fire?" handling needed. (Using `metadataCache.on('resolved')` as an accelerant was considered and deferred — see Scope Boundaries — because it fires when relationships are coldest and the event repeats, complicating dormancy cleanup.)

- **Re-checks override PR #166's caching during the window.** PR #166 caches a tasks-warm index as authoritative (incl. empty maps). The window deliberately re-asserts `enrichmentDirty` on each attempt so a tasks-warm-but-edges-cold index is re-fetched anyway, until edges appear or the cap hits. Outside the window, #166's caching stands unchanged.

- **Silent heal.** The chart shows matched-only and then fills in when relationships resolve; no "loading relationships…" affordance. A loading cue is deferred (see Scope Boundaries).

- **Completes the U7 seam — via a narrow trigger, not the existing hook.** The dormant `onExternalSourceChange()` hook does more than the window needs: it also clears the source memo (`taskNotesResolved=false`, re-creating the TaskNotes source + re-awaiting `lifecycle.ready()`) and refreshes *without* `reuseTasks` (re-reading every Bases entry — the read #161's storm fix avoids). The window instead uses a minimal trigger: flip `enrichmentDirty` and `refreshSource({reuseTasks:true})`, so only the relationship index is re-fetched. The scheduler lives in the view (an Obsidian `Component`), cleaned up on unmount like the existing refresh coalescer.

## Requirements

**Heal behavior**
- R1. After mount, when companion mode (Show-all/Inherit with TaskNotes) is active and the cached relationship index is **non-null but has no resolved edges for the matched set** — the post-#166 lag state: a tasks-warm index whose `childrenByPath` is empty, which the existing `if (!this.relationshipIndex)` guard will not re-fetch on its own — the controller must re-fetch the index on a bounded schedule until matched-set edges resolve or the attempt cap is reached.
- R2. The window must stop early on the first re-fetch that resolves children for at least one currently-matched parent, then go dormant — **not** on the first edge appearing anywhere in the vault index, and **not** on an all-empty/unchanged ("content-stable") index (which is indistinguishable from a warmup lull). The no-edges case is handled solely by the attempt cap (R3).
- R3. When edges never appear within the cap, the window must stop after the final attempt and go dormant — no further full-vault scans on subsequent Bases notifies.
- R4. A view mounted when the index is already warm must heal on the first build and incur no additional readiness re-fetches.
- R11. When companion mode is inactive (standalone — `companionAccessor === null`, TaskNotes absent), the readiness window must not activate: no scheduler, no re-checks, no overhead.

**Bound & scheduling**
- R5. The bound is a fixed maximum attempt count with exponential backoff between attempts. The count, base delay, and backoff factor are named, injectable constants (not magic literals) so tests can drive them deterministically.
- R6. The scheduler is owned by the view's lifecycle and is cancelled on unmount/remount; a re-check queued before teardown must not fire against a torn-down controller.
- R7. Each readiness re-check invalidates only the enrichment cache — flip `enrichmentDirty` and recompute with `reuseTasks:true` (NOT via `onExternalSourceChange`, which also re-resolves the source and re-reads Bases entries) — so the next build re-fetches the relationship index, overriding the "authoritative-empty is cached" rule from PR #166 for the duration of the window only.
- R13. A readiness re-check that runs after warmed relationships are available must not be silently dropped — neither suppressed by the existing 500ms refresh coalescer nor discarded by the latest-wins `recomputeSeq` guard — before its re-fetch executes. (Whether re-checks route through the coalescer or bypass it is a planning decision; the requirement is the no-drop constraint, not the routing choice.)

**Perf & non-regression**
- R8. In steady state (window dormant), behavior is identical to today: the relationship index is read once and reused across Bases notifies; no readiness machinery runs.
- R9. The readiness window must not re-introduce the #161 render loop. Re-checks that produce no content change must not notify the view (the existing idempotent recompute backstop covers this); re-checks are bounded and must not feed a re-notify storm.
- R10. A genuinely no-relationships vault pays at most the bounded attempts once per mount, then nothing.
- R12. The warmup cost is explicitly bounded: at most N full-vault relationship scans per mount (N = the attempt cap), and the backoff schedule must be tuned so attempts do not pile onto the in-progress cold `metadataCache` scan. This worst case is an accepted, harness-measured tradeoff — not a steady-state cost (cf. R8).

## Acceptance Examples

- AE1. **Relationship-lag heals.** *Covers R1, R2, R7.* Mount with `tasks.list()` returning ≥1 task but `childrenByPath` empty; on a later attempt the index returns edges → Show-all expands to include fetched rows, and no further readiness re-fetch occurs.
- AE2. **No-relationships vault is bounded.** *Covers R3, R5, R10.* Mount with ≥1 task and no edges ever; the controller re-fetches exactly up to the cap (per the backoff schedule), then performs zero further readiness re-fetches across subsequent notifies.
- AE3. **Already-warm mount is free.** *Covers R4, R8.* Mount when the index already has edges; attempt 1 is authoritative, the window stops immediately, and no extra re-fetch is scheduled.
- AE4. **Teardown mid-window is safe.** *Covers R6.* Unmount while a backoff timer is pending; the pending re-check does not fire (or no-ops) and does not throw.
- AE5. **No loop.** *Covers R9.* A bounded readiness window over an unchanging matched set produces no growth in recompute/notify count beyond the bounded attempts; a re-check whose snapshot is unchanged does not notify (idempotent backstop).
- AE6. **Standalone is a no-op.** *Covers R11.* Mount with TaskNotes absent (`companionAccessor === null`); no readiness scheduler is created and no re-checks fire.
- AE7. **Partial warm does not stop early.** *Covers R2.* Mount with ≥1 task; a re-check resolves children for an *unmatched* parent only (matched parents still cold) → the window does NOT stop; it continues until a matched parent resolves children or the cap hits. A re-check that returns an all-empty/unchanged index likewise does NOT stop the window (no content-stability early-stop).
- AE8. **Backoff does not pile onto the cold scan.** *Covers R12.* With harness instrumentation, readiness attempts during an in-progress cold `metadataCache` scan are spaced by the backoff schedule (never concurrent with it or each other), and the total attempt count stays within the cap.
- AE9. **A racing refresh does not drop a heal.** *Covers R13.* A readiness re-check that observes warmed relationships while a config refresh races it is not silently dropped — the warmed index reaches the view.

## Scope Boundaries

- **Deferred for later:** a "loading relationships…" UX affordance during the window; using `metadataCache.on('resolved')` as an accelerant. The `'resolved'` accelerant was evaluated and deferred (not adopted) because it fires when the cold scan *ends* — before relationships warm (so an immediate re-check observes empty edges and wastes an attempt), it **repeats** on every later vault edit (so the listener must be explicitly detached at dormancy or it re-introduces the per-edit full-vault scan R8/R10 forbid), and the backoff schedule already covers the cold-start timing. Revisit only if harness measurements show the base delays are meaningfully too slow.
- **Residual (accepted):** this bounded window *narrows* the gap, it does not *close* it. On vaults whose relationship warmup exceeds the attempt cap (the perf E2E observes multi-minute cold scans), Show-all still degrades to matched-only with manual-edit recovery — the same failure the work targets, now rarer. Tuning the cap/backoff from harness measurements (R5, R12) is how this residual is kept small.
- **Outside this work:** an upstream TaskNotes "relationships-ready" event (not ours to add; we poll because none exists); the #161 P2 render-freeze at large instance counts; non-TaskNotes live updates (out of scope by design — TaskNotes notes only).

## Dependencies / Assumptions

- Builds on PR #166 (`fix/show-all-readiness-index-cache`): `getRelationshipIndex()` returns `null` for not-ready and a non-null index (incl. empty maps) for authoritative. The window layers on top.
- **Load-bearing #166 behaviors:** the window depends on #166's contract that `getRelationshipIndex()` returns `null` for not-ready and a non-null index (incl. empty maps) for ≥1 task (authoritative, cached). If #166's caching semantics change in review (e.g. it stops caching empty maps, or redefines "not-ready"), R1's trigger condition and R7's override must be re-verified against the **merged `main`**, not the open PR diff.
- Assumes relationship resolution lags file/`lifecycle.ready()` resolution (verified: `test/specs/gantt-perf-fullstack.perf.e2e.ts:259-262`).
- Assumes resolved children for a *currently-matched* parent (not any global edge) is a sufficient positive "relationships warmed" signal for early-stop. A matched set whose parents genuinely have no children cannot be distinguished from "not yet warmed" — handled by the attempt cap, accepted.
- Assumes the existing idempotent recompute backstop suppresses notify on a re-check whose snapshot is unchanged (the #161 loop guard).

## Outstanding Questions

**Deferred to planning**
- Exact constant values (attempt cap, base delay, backoff factor) — pick defaults that cover typical cold warmups (seconds) and measure against the perf harness.
- Whether the scheduler re-uses the existing coalescer/timer infrastructure in the view or adds a dedicated bounded-backoff helper.
- Where the early-stop signal is evaluated (controller exposes "index has edges" vs the view inspects) — an interface detail for the U7 wiring.

## Sources / Research

- `src/controller/GanttController.ts` — `buildSnapshot()` enrichment cache (`relationshipIndex`/`enrichmentDirty`), `onExternalSourceChange()` (the U7 seam, no production caller).
- `src/datasource/TaskNotesSource.ts` — `getRelationshipIndex()` (PR #166 readiness contract), `getParents()`.
- `src/bases/register.ts` — `mountGantt()`/`onunload()` view lifecycle, the `refreshCoalescer` pattern (model for a view-owned bounded scheduler).
- `test/specs/gantt-perf-fullstack.perf.e2e.ts:244-281` — the three-stage readiness poll (API ready → every file resolved → relationships resolved); evidence that relationships lag and that polling is the only known signal.
- `docs/bug-reports/2026-06-24-resultset-render-loop-161.md` — §5 row 4 (index-fetch cleared as the loop driver → risk is perf not loop), §11 (this bug).
