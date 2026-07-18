---
module: svar-gantt
tags: [svar, pro-features, split-task, segments, markers, baselines, rollups, critical-path, slack, feasibility-spike]
problem_type: integration-feasibility
status: inconclusive
---

# SVAR "Pro"-gated feature render support in the bundled free build

## Question

Can the plugin render SVAR-Gantt "Pro"-documented features — split-task/`segments`, `markers`, `baselines`, `rollups`, `criticalPath`, `slack` — using the bundled free/OSS `@svar-ui/svelte-gantt@^2.7.0`, without a commercial licence? Motivated by wanting to draw a discontinuous task (e.g. a recurring series) as spaced segments in one row.

## Method

An isolated probe (`test/probe/`, run via `npm run probe:svar`) mounts the **raw** SVAR `<Gantt>` with SVAR's default templates (no plugin `taskTemplate`) in headless Chromium (`vitest-browser` + playwright), feeds each feature the documented input + config prop, and records which SVAR DOM hooks appear. Hard-gated: harness sanity (a plain task draws `.wx-bar`) and a negative control. Per-feature verdicts are soft-recorded to `test/probe/.results/verdicts.json`, so "does-not-render" is data, not a failure.

## Result — code ships, but minimal repro did not trigger it (INCONCLUSIVE)

The "Pro" features are **not stripped** from the free npm package. The rendering code is fully present and wired end-to-end:

- Components ship: `node_modules/@svar-ui/svelte-gantt/src/components/chart/BarSegments.svelte`, `chart/Rollups.svelte`, `editor/Segments.svelte`. `Bars.svelte` renders segments at the conditional `{:else if $splitTasks && task.segments}` and adds `wx-split` / `wx-baseline` / `wx-critical` / `wx-slack` under their own gates.
- The store processes them: `@svar-ui/gantt-store/dist` handles `splitTasks` and `segments` (segment layout computed in the `_tasks` derivation); no licence / trial / watermark gate was found anywhere in the component or store source.
- Props flow: `Gantt.svelte` passes `splitTasks`, `markers`, `baselines`, `rollups`, `criticalPath`, `slack` straight into `dataStore.init`.

**But** the isolated raw-`<Gantt>` probe produced **no** feature DOM for any of the six features — across two runs (props via spread, then explicit named props) the rendered `wx-*` vocabulary was identical with and without each feature enabled (only base `wx-bar` / `wx-row` / `wx-summary` / `wx-progress-marker`). The render condition `$splitTasks && task.segments` stayed false despite `splitTasks={true}` and a `segments` array on the task.

Conclusion: enabling these is **not** "just set the documented prop + data" in a bare harness — there is an additional trigger (likely a data-shape or store/init-timing detail matching SVAR's own demo) that the minimal probe does not satisfy. Feasibility is therefore **encouraging but unproven**: the code exists in the free build, but we do not yet have a working repro that renders it.

## Per-feature verdicts (isolated probe, minimal inputs)

| Feature | Prop + input supplied | Rendered in probe | Code present in OSS build |
|---|---|---|---|
| split-task / `segments` | `splitTasks` + `segments[]` | no | yes (`BarSegments.svelte`) |
| split-task, no flag | `segments[]` only | no | n/a (flag off is expected off) |
| `markers` | `markers[]` | no | yes (store handles `markers`) |
| `baselines` | `baselines` + `base_start/end` | no | yes (`Bars.svelte` `.wx-baseline`) |
| `rollups` | `rollups` + `rollup:true` children | no | yes (`Rollups.svelte`) |
| `criticalPath` | `criticalPath` + linked tasks | no | yes (`.wx-critical` gate) |
| `slack` | `slack` + `criticalPath` | no | yes (`.wx-slack` gate) |

Because Step 1 produced no confirmed survivor, the planned Step-2 real-Obsidian confirmation (through `GanttContainer`'s custom `taskTemplate`) was not run — there was nothing to confirm.

## Open thread (next repro step)

Reproduce SVAR's own split-task demo setup exactly (its published example enables `splitTasks`) and diff it against this probe to find the missing trigger — candidates: required segment fields beyond `start`/`end`, a `$effect`/re-init timing issue in the isolated mount, or a theme/scale/`cellWidth` prerequisite for segment `$x`/`$w` layout. Only once a feature renders in the probe does the Step-2 template-suppression question become meaningful.

## Licence caveat (unresolved, separate from rendering)

Rendering feasibility is distinct from ship-ability: the code being present in the GPL-licensed OSS package does not by itself establish that shipping these features in the plugin is permitted under SVAR's terms. Out of scope for this spike.
