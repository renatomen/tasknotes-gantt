# Requirements — Gantt performance harness & perf gate

**Date:** 2026-06-25
**Status:** Requirements (ready for `/ce-plan`)
**Related:** [docs/bug-reports/2026-06-24-resultset-render-loop-161.md](../bug-reports/2026-06-24-resultset-render-loop-161.md) (#161 — the bug this instrument is built to crack)

## Summary

A deterministic, seeded generator that produces a **production-shaped vault** (~10,000 notes, ~5,000 of them TaskNotes tasks) with the full structural mix and relationships spanning the whole task set, plus a **two-layer performance gate**: an isolated render harness (real controller → real Gantt component in a headless browser) as the fast PR gate, and a full-stack run over the generated vault for fidelity. The gate asserts on **deterministic metrics** — DOM-node count (does SVAR virtualize?), rendered-instance-count vs input, and a build/expansion time ceiling — with wall-clock render time tracked as a trend.

## Problem Frame

Investigation of #161 burned a full day in a loop: hypothesize → declare a fix → validate through slow, noisy, manual in-vault captures (≈30 s per iteration, DevTools artifacts confounding the signal) → fix fails → repeat. The root failure was **methodological**: there was no reproducible, measurable target for the layer that actually freezes.

The bug report's current state (P2, still open) localizes the freeze to **SVAR's render of large instance counts inside Obsidian** — the data pipeline is already fast (~200 ms for 2660 instances, instrumented). The decisive open question is whether **SVAR virtualizes** the render or materializes all rows (a first screenshot showed ~45,298 `wx-*` DOM nodes ≈ 2660 rows × ~17). That question is answerable by a deterministic **DOM-node count**, not by another manual capture.

This harness is the instrument that makes the freeze reproducible and measurable on demand, turns "is it virtualizing?" into a number, and — once it exists — becomes a permanent gate against perf regressions (O(N²) expansion, lost virtualization, instance-count blowups).

## Requirements

- **R1 — Deterministic seeded generator.** Produce a vault from a fixed seed so output is byte-reproducible; the same seed must yield the same graph (a gate cannot tolerate run-to-run variance).
- **R2 — Production-shaped scale.** ~10,000 notes total, of which ~5,000 are TaskNotes tasks (the rest non-task notes), matching the production vault's proportions.
- **R3 — Structural coverage.** The task graph must include, in a tunable mix:
  - Simple parents with a few subtasks.
  - Deep nesting (≥5 levels: parent → subtask → sub-subtask → …).
  - Multi-parent tasks (a task belonging to 2, 4, and 7 parents).
  - Dependencies (`blockedBy` relationships).
  - A date-coverage mix: fully dated, undated, start-only, end-only (exercises the date policy + the "Show tasks with no date" / partial-date toggles implicated in #161).
  - Cycles in the `projects` graph (exercises the expander's cycle-breaking).
  - Orphans / dangling references (parent points to a non-existent or non-matched note — the dangling-parity path).
  - Status variety (exercises status-color rendering) and at least one wide fan-out node (hundreds of children — the fan-out-cap path).
- **R4 — Filter-narrows-but-relationships-span.** A configurable Base filter narrows the ~5k tasks to a realistic **matched subset (~261, production-like)**, while relationships deliberately **cross the filter boundary** so Show-all / multi-parent expansion pulls related tasks from outside the matched set back in. This reproduces both the full-vault relationship-index read and the 261-matched → 2660-rendered instance explosion.
- **R5 — Parameterized by render load.** The generator is dialed by **target rendered-instance count and fan-out depth**, not only raw note count — because the freeze scales with rendered instances, not notes. (10k notes is one calibration point, not the control variable.)
- **R6 — Layer 1: isolated render harness.** Drive the real controller (in-memory, no Obsidian) over generator output, then mount the **real Gantt component in a headless browser** and measure expansion + SVAR render. Isolates "is it SVAR's render or the Bases/Obsidian integration?" Fast and deterministic enough to gate every PR.
- **R7 — Layer 2: full-stack run.** Exercise the real plugin in real Obsidian over the generated vault via the existing WebdriverIO suite ([test/wdio/](../../test/wdio/), [test/specs/](../../test/specs/)) for end-to-end fidelity.
- **R8 — Deterministic hard-gate metrics.** Block on:
  - **DOM-node count** stays bounded for a given rendered-instance count (i.e. virtualization holds — the direct catch for the P2 regression).
  - **Rendered-instance count** matches expected bounds for a given input graph (catches expansion blowups / multiplier regressions).
  - **Build/expansion time ceiling** (generous bound guarding against reintroducing O(N²)).
- **R9 — Wall-clock as trend.** Capture render/settle wall-clock time and record it as a tracked trend; **non-blocking on the per-PR gate** (CI-runner noise), may block on the controlled scheduled full-stack run.
- **R10 — On-demand vault.** The large vault is generated into a temp/scratch directory at run time; it is **not committed** to the repo.
- **R11 — Diagnosis-first use.** The harness's first job is to answer P2: at ~2660 instances, does SVAR virtualize (bounded DOM-node count) or materialize all rows, and where does the render time go.

## Key Decisions

- **KD1 — Gate on deterministic metrics, not wall-clock.** DOM-node count / instance count / build-time ceiling are CI-stable and a more *direct* catch of the actual regression than a noisy wall-clock threshold. Wall-clock is the user-facing symptom but the flaky metric — track it, don't gate the PR on it. (Rationale: wall-clock perf assertions on shared CI runners erode trust via intermittent failures.)
- **KD2 — Two measurement layers.** Isolated render (Layer 1) + full-stack (Layer 2), chosen over a single layer to **separate SVAR-render cost from Bases-integration cost** — the variable conflation that wasted the most time in #161.
- **KD3 — Dial by instance count / fan-out, not note count.** The freeze scales with rendered instances (261→2660 via multi-parent expansion). The generator's primary knobs target instances and fan-out; note count is derived.
- **KD4 — Per-PR isolated gate; full-stack perf scheduled.** Default split: the fast isolated gate runs per-PR; the heavy generated-vault full-stack perf run is scheduled/separate to keep PR CI fast. (See Open Questions — revisable.)
- **KD5 — Model the filter/relationship boundary explicitly.** The generator does not just emit 261 tasks; it emits ~5k with a filter selecting ~261 and edges crossing the boundary. This is the fidelity property that reproduces the real cost profile.

## Scope Boundaries

**Out of scope / deferred:**
- **Fixing #161 (P2) itself.** This deliverable is the instrument. Localizing and fixing the render freeze is the immediate *next* step the harness enables — tracked separately.
- **Committing the large vault** as a fixture (R10 — generated on demand).
- **Broad perf refactors** of the plugin (instance-explosion reduction, bulk diff-sync via `provide-data`, SVAR 2.3.0→2.7.0 upgrade) — these may become fix candidates *after* the harness localizes the bottleneck, but they are not part of building the harness.
- **Non-perf test coverage** — the harness measures performance/scale; functional correctness stays with the existing unit + e2e suites.

## Dependencies / Assumptions

- **Verified:** CI already runs the full WebdriverIO + real-Obsidian e2e on every PR ([.github/workflows/ci.yml](../../.github/workflows/ci.yml), `e2e` job, builds into a temp vault + downloads TaskNotes). A `test/vaults/` fixtures dir and precedent perf-adjacent specs (`gantt-theme-toggle-loop.e2e.ts`, `gantt-viewport-sizing.e2e.ts`) already exist. No graph/vault generator exists today.
- **Assumption (verify in planning):** Layer 1 needs a **headless-browser component-mount runner** (new infra; e.g. Playwright) — jsdom (current jest env) cannot measure layout/virtualization.
- **Assumption (verify in planning):** [src/bases/GanttContainer.svelte](../../src/bases/GanttContainer.svelte) can mount standalone with injected props (data store, app, config) outside Obsidian. The controller ([src/controller/GanttController.ts](../../src/controller/GanttController.ts)) is already DI'd and runs in-memory in unit tests.
- **Assumption:** the generator's `projects` / `blockedBy` frontmatter reproduces TaskNotes' relationship semantics faithfully enough that the controller's companion expansion behaves as in production (the relationship index reads the same shape).

## Success Criteria

- The freeze is **reproducible on demand without manual in-vault steps** — one command produces the vault and a measurement.
- The **virtualization question is answered by a number**: DOM-node count at ~2660 instances clearly shows bounded (virtualizing) vs ~45k (materializing all rows).
- The gate **fails on a reintroduced regression** (e.g. an artificially O(N²) expansion, or a forced non-virtualized render) and **passes on healthy code** — demonstrated, not assumed.
- The isolated Layer-1 gate runs fast enough to sit on every PR without materially slowing CI.
- The generator is deterministic: same seed → identical graph → stable metrics across runs.

## Open Questions

- **Full-stack cadence (KD4):** per-PR vs scheduled/label-triggered for the heavy generated-vault run. Defaulted to scheduled; revisit once Layer-1 runtime is known.
- **Threshold calibration:** the exact DOM-node bound, instance-count bound, and time ceiling must be calibrated from the first real runs (set after diagnosis, not guessed up front).
- **Layer-1 mounting:** whether `GanttContainer` mounts cleanly standalone or needs a thin test-host wrapper component to supply the props/stores it expects from `register.ts`.
