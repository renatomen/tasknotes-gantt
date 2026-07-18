---
module: svar-gantt
tags: [svar, pro-features, split-task, segments, markers, baselines, rollups, critical-path, slack, feasibility-spike]
problem_type: integration-feasibility
status: resolved
---

# SVAR "Pro"-gated feature render support in the bundled free build

## Question

Can the plugin render SVAR-Gantt "Pro"-documented features — split-task/`segments`, `markers`, `baselines`, `rollups`, `criticalPath`, `slack` — using the bundled free/OSS `@svar-ui/svelte-gantt@^2.7.0`, without a commercial licence? Motivated by wanting to draw a discontinuous task (e.g. a recurring series) as spaced segments in one row.

## Answer: no via config — this is the MIT "open" edition, which disables Pro features at store init

The installed packages (`@svar-ui/svelte-gantt` + `@svar-ui/gantt-store` 2.7.0) are the **MIT-licensed "open/community" edition**; split-task/segments, markers, baselines, rollups, `criticalPath`, and `slack` are **PRO-only** features (`svelte-gantt/readme.md` lists "Split tasks" under "### PRO Edition"). The open build gates them two ways:

1. **The store forces the flags off.** `DataStore.init` runs a community gate — recovered from the sourcemap as `if (isCommunity()) { … state.splitTasks = false; state.baselines = false; state.markers = []; state.criticalPath = null; state.rollups = false; state.slack = false; … }` — and in the shipped dist `isCommunity()` folds to true at build time, so the reset is unconditional. In minified form (`node_modules/@svar-ui/gantt-store/dist/index.js`):

   ```js
   t.unscheduledTasks=!1, t.baselines=!1, t.markers=[], t._markers=[],
   t.undo=!1, t.schedule={}, t.criticalPath=null, t.splitTasks=!1,
   t.summary={}, t.rollups=!1, t._rollups={}, t.slack=!1, ...
   ```

   `getReactive()` returns `this._state`, so `api.getReactiveState().splitTasks` is a real store — but committed as hardcoded `false`. `Bars.svelte:562` only renders `<BarSegments>` under `{:else if $splitTasks && task.segments}`, so it falls through to one plain `wx-content` bar.

2. **The Pro positioning code is compiled out.** The segment date/layout logic (`calcSplitDates`, `pro/splitTasks`) sits behind `// #if [!(WX_PACKAGE_TYPE=open)]` fences and is stripped from the open build (`calcSplitDates` = 0 occurrences in the dist; no `pro/` sources in the sourcemap). So even if the flag were forced true, there is no code to compute each segment's `$x`/`$w`.

`BarSegments.svelte` ships only because it is plain Svelte source under `src/`; it is dead code in this edition.

## Evidence (two independent confirmations)

1. **Empirical (store state).** An isolated probe (`test/probe/`, `npm run probe:svar`) mounts the raw `<Gantt>` in headless Chromium (`vitest-browser` + playwright) and reads `api.getState()`. Even a direct `<Gantt tasks={[{...,segments:[...] }]} splitTasks={true}>` yields `state.splitTasks === false` and `$splitTasks === false`; the task keeps its `segments` array but the segments never get `$x`/`$w` (layout only runs them when `splitTasks` is true), so one plain bar renders. Captured in `test/probe/.results/diag.json`.
2. **Source (the gate).** The `init(t)` reset above, read directly from the installed `gantt-store` dist, plus the `isCommunity()` / `WX_PACKAGE_TYPE=open` fences recovered from `gantt-store/dist/index.js.map` (`DataStore.ts` `init`, `normalizeDates.ts` split branch). The component rendering code is present (`svelte-gantt/src/components/chart/BarSegments.svelte`, `chart/Rollups.svelte`, `Bars.svelte` `.wx-baseline`/`.wx-critical`/`.wx-slack` gates) but unreachable, and the Pro positioning code (`calcSplitDates`) is absent from the dist. Cross-checked by three independent source passes.

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

1. **SVAR commercial/Pro edition** — the Pro `@svar-ui/svelte-gantt` + `gantt-store` build has `isCommunity()` false and includes `pro/splitTasks` (`calcSplitDates`), so the config value survives and segments position correctly. Cost + licence purchase; verify the Pro package before committing. On Pro, shape each segment as `{ id, text, start, duration }` (not `{ start, end }`) with the parent keeping its own `start` + `segments`, matching `editor/Segments.svelte` and `calcSplitDates`.
2. **Patch/fork the open store** — not viable. Un-resetting the flag is not enough: the Pro positioning code (`calcSplitDates`) is compiled out of the open build, so you would have to reimplement segment layout as well, and shipping a re-enabled Pro feature is the same licence question as buying Pro. Do not pursue.
3. **Hand-roll spaced sub-bars ourselves** — draw the segments in a custom `taskTemplate` / `BarContent` overlay (absolute-positioned sub-bars inside one row), fed by our own data (e.g. expanded recurrence occurrences). This is independent of SVAR's gated split-task, licence-clean, and the only route that fits the plugin's existing custom-bar rendering. It is a real feature project, not a config flag — this is where the deferred recurring-as-segments product design would land. **Recommended** if the feature is pursued.

## Licence note

The installed edition is **MIT** (`@svar-ui/svelte-gantt` + `gantt-store` `"license": "MIT"`), so the base gantt is freely usable, but split-task/segments and the other Pro features are not available in it. The DIY overlay (option 3) is licence-clean because it does not use SVAR's gated feature at all; option 1 requires a SVAR Pro licence; option 2 is both technically incomplete and licence-questionable.
