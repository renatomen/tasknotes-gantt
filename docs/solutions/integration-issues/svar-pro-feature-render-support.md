---
module: svar-gantt
tags: [svar, pro-features, split-task, segments, markers, baselines, rollups, critical-path, slack, feasibility-spike]
problem_type: integration-feasibility
status: resolved
---

# SVAR "Pro"-gated feature render support in the bundled free build

## Question

Can the plugin render SVAR-Gantt "Pro"-documented features — split-task/`segments`, `markers`, `baselines`, `rollups`, `criticalPath`, `slack` — using the bundled free/OSS `@svar-ui/svelte-gantt@^2.7.0`, without a commercial licence? Motivated by wanting to draw a discontinuous task (e.g. a recurring series) as spaced segments in one row.

## Answer: no via config — the free store hard-disables them at init

The free build **ignores** every advanced/"Pro" config key. `@svar-ui/gantt-store`'s `DataStore.init(t)` unconditionally overwrites the caller's config before it reaches state (`node_modules/@svar-ui/gantt-store/dist/index.js`):

```js
init(t){ /* ... */
  t.unscheduledTasks=!1, t.baselines=!1, t.markers=[], t._markers=[],
  t.undo=!1, t.schedule={}, t.criticalPath=null, t.splitTasks=!1,
  t.summary={}, t.rollups=!1, t._rollups={}, t.slack=!1,
  t.resources=null, t._resources=[], t.assignments=[],
  t.calendar=null, t.calendars=[], t.groupBy=null, t.wbs=null;
  /* ... then applies t to state ... */
}
```

These are unconditional assignments (a flat comma-sequence, no guard), so no matter what you pass to `<Gantt splitTasks markers baselines rollups criticalPath slack ...>`, the store forces them to their off-defaults. The rendering code ships but is **dead code** in the free build: `BarSegments.svelte` only renders under `{:else if $splitTasks && task.segments}`, and `$splitTasks` can never become true because the store reset it.

This is the mechanism behind SVAR marketing these as "Pro" features while the OSS package still contains their source: the gate lives in `gantt-store.init`, not in stripped components.

## Evidence (two independent confirmations)

1. **Empirical (store state).** An isolated probe (`test/probe/`, `npm run probe:svar`) mounts the raw `<Gantt>` in headless Chromium (`vitest-browser` + playwright) and reads `api.getState()`. Even a direct `<Gantt tasks={[{...,segments:[...] }]} splitTasks={true}>` yields `state.splitTasks === false` and `$splitTasks === false`; the task keeps its `segments` array but the segments never get `$x`/`$w` (layout only runs them when `splitTasks` is true), so one plain bar renders. Captured in `test/probe/.results/diag.json`.
2. **Source (the gate).** The `init(t)` reset above, read directly from the installed `gantt-store` dist. The component/store rendering code is present (`svelte-gantt/src/components/chart/BarSegments.svelte`, `chart/Rollups.svelte`, `Bars.svelte` `.wx-baseline`/`.wx-critical`/`.wx-slack` gates) but unreachable.

## Per-feature verdicts (isolated probe)

| Feature | Prop + input supplied | Renders in free build | Why |
|---|---|---|---|
| split-task / `segments` | `splitTasks` + `segments[]` | no | store `init` forces `splitTasks=false` |
| `markers` | `markers[]` | no | store `init` forces `markers=[]` |
| `baselines` | `baselines` + `base_start/end` | no | store `init` forces `baselines=false` |
| `rollups` | `rollups` + `rollup:true` children | no | store `init` forces `rollups=false` |
| `criticalPath` | `criticalPath` + linked tasks | no | store `init` forces `criticalPath=null` |
| `slack` | `slack` + `criticalPath` | no | store `init` forces `slack=false` |

The planned Step-2 real-Obsidian confirmation (through `GanttContainer`'s custom `taskTemplate`) is moot: with zero features reachable at the store level, our template is not the suppressor, so there is nothing to confirm.

## Options to actually get spaced segments

1. **SVAR commercial/Pro distribution** — presumably ships a `gantt-store` without the `init` reset. Cost + licence change; verify the Pro package actually removes the gate before committing.
2. **Patch/fork the free store** — override `DataStore.init` to stop resetting the keys. Fragile (breaks on upgrade), and shipping a patched Pro-feature is the same licence question as buying Pro — likely not permitted. Not recommended.
3. **Hand-roll spaced sub-bars ourselves** — draw the segments in a custom `taskTemplate` / `BarContent` overlay (absolute-positioned sub-bars inside one row), fed by our own data (e.g. expanded recurrence occurrences). This is independent of SVAR's gated split-task, licence-clean, and the only route that fits the plugin's existing custom-bar rendering. It is a real feature project, not a config flag — this is where the deferred recurring-as-segments product design would land.

## Licence caveat

Rendering feasibility is distinct from ship-ability. Even where code exists in the GPL-licensed OSS package, enabling Pro features by patching the store may violate SVAR's terms. The DIY overlay (option 3) avoids this because it does not use SVAR's gated feature at all. Legal confirmation is out of scope for this spike.
