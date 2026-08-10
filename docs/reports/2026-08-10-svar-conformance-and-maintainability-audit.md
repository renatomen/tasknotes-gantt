# SVAR conformance & maintainability audit

**Date:** 2026-08-10
**Trigger:** a four-PR feature (missing-date zigzag semantics) consumed ~10 hours and shipped two user-visible defects. The maintainer's verdict: *"the hours spun and the bugs created prove our plugin maintainability is poor."*
**Question asked:** does the plugin conform to the standing directive — *do not reinvent or hand-roll what SVAR provides; exceptions require explicit authorisation and must be elegant* — and where is the maintainability debt actually located?
**Method:** three independent read-only audits. Every SVAR claim was verified against `node_modules/@svar-ui/**` source, not documentation. SonarQube was deliberately not consulted.

---

## Verdict

**The directive is largely being honoured.** This was the surprise. Of the entire custom-code surface, exactly two items are genuine violations — SVAR ships the capability and we overrode it anyway — and both are trivial. Everything else falls into one of three legitimate buckets:

1. **Pro-gated.** `DataStore.init` unconditionally nulls the whole Pro surface over whatever config we pass:
   `splitTasks, markers, calendar, calendars, baselines, summary, criticalPath, slack, rollups, resources, groupBy, wbs, undo, unscheduledTasks`.
   `createCalendar` is exported but returns `null`; the Calendar class is stripped from the bundle. There is no API we declined to use. Ghost runs, occupancy, the marker overlay and the calendar subsystem are the authorised exceptions, correctly identified.
2. **A real API gap.** `ITask` has **no `css` / `className` / `shape` field**. The only per-bar class hook is `type`, whole-string-matched against a pre-registered array (`Bars.svelte:417-424`). And SVAR offers no bar-silhouette control at any tier — only colour, `border-radius`, `box-shadow`, `border`. Both gaps are confirmed by source.
3. **Deliberate product calls** — delegating editing and menus to TaskNotes; the Obsidian-scoped maximize (maintainer-signed-off).

**So the problem is not *what* we build. It is *how it is seated* and *how it is proven*.**

---

## Two live shipped defects

Both found by the audit, both cheap, both with zero test coverage.

### D1 — the legend is lying to users
`legendCatalog.ts:155-156` still describes *"an orange fill"* and *"a red border"* for inferred ranges. `visualSemantics.ts:98-103` documents the shipped behaviour as the opposite: *"neither repaints the bar in a colour of its own."* PR #398 retired the colour treatment; the legend update was scheduled as a separate later unit and never landed.

**Root cause is decomposition, not oversight.** Microscopic PRs are correct, but each must leave the *product* coherent, not merely the build green. Splitting "remove the colour" from "update the legend" guaranteed an incoherent intermediate state on `main`.

### D2 — the dependency tooltip renders an empty box
SVAR 2.7.0 changed tooltip content props to `{ api, data: { task, segmentIndex } }` (`widgets/Tooltip.svelte:28`, and `types/index.d.ts:72-84`). `DependencyTooltip.svelte:15` destructures `{ data }` and reads `data?.text` / `data?.custom?.incomingDeps` — both `undefined` under the new shape.

The 2.3.0→2.7.0 upgrade commit asserted *"the tooltip shape break doesn't touch our code."* The file was created **the next day** against the old shape and never modified since. Fix is ~2 lines.

Related staleness: the comment at `GanttContainer.svelte:2672` — *"SVAR has no native link tooltip"* — was true in 2.3.0 and is false in 2.7.0.

---

## Where the hours actually go

### Change amplification: one bar semantic = 6–8 files, 4 layers, 3 languages

Measured across the four zigzag commits (`753f134`, `b048f92`, `2dffe06`, `7734e22`):

```
datePolicy.ts (union)
  → ganttSync.ts (publish + fingerprint + task-type registry)
    → BarContent.svelte (imperative attach + pixel geometry)
      → GanttContainer.svelte (~420 lines of hand-written :global CSS)
        → barTreatment.ts (republish the fill so the treatment can draw in it)
          → legendCatalog.ts (the legend row)   ← missed; became defect D1
```

`visualSemantics.ts` was built to be the single naming point — its header says so — but holds only string constants. Miss any step and you ship a silent partial feature.

### The junction box

`GanttContainer.svelte`: **4,253 LOC, 86 commits — edited in 19% of every commit ever made to this repo.**
59.6% script / 33.8% stylesheet / **6.6% markup**. 59 imports, 154 `!important`, 105 `:global()` escapes, 20 distinct SVAR-internal selectors, 17 separable concerns, and 9 `api.intercept` registrations inside a single 327-line function.

### The verification loop — and the tool already in the repo

`jest.config`'s `testMatch: ["**/*.test.ts"]` silently excludes every `.svelte` file. 152 unit test files; **none targets a component**. So 4,747 lines of render layer are provable only by launching real Obsidian. `gantt-date-handling.e2e.ts` is 1,875 lines and grew by 1,664 across three zigzag commits.

**`test/probe/vitest.config.ts` already exists**: vitest browser mode, Playwright + Chromium, mounts a real `<Gantt>`, takes screenshots. Its existing snapshots are named:

- `CONTRACT--the-transparency-rule-beats-SVAR-s-own-background-1.png`
- `CONTRACT--earned-specificity-beats-SVAR-s-background---no--important-anywhere-1.png`
- `the-outer-bar-is-blanked-while-the-segments-keep-their-fill-1.png`

Those are precisely the propositions the zigzag work re-litigated through 1,664 lines of WDIO. The config header calls itself *"the throwaway SVAR feature probe (spike)"*; `npm run probe:svar` runs in no gate.

---

## Imitation instead of reuse — four parallel mechanisms for one job

The repo has a recorded lesson that imitating an existing mechanism rather than reusing it caused repeated regressions. It recurred here, measurably.

**Making a bar's host transparent — 4 mechanisms:**

| # | Mechanism | Site |
|---|---|---|
| 1 | Stamp SVAR's own `wx-split` so its `:not(.wx-split)` fill rule steps aside | `BarContent.svelte:194-206` |
| 2 | A separate painted `.og-bar-body` layer + host `background-clip: content-box !important` | `BarContent.svelte:411`, `GanttContainer.svelte:3344` |
| 3 | Direct `background-color: transparent !important` for the swapped state | `GanttContainer.svelte:3651` |
| 4 | The same trick again at piece level, with a 5-state `:not()` exclusion list | `GanttContainer.svelte:3690` |

Mechanism 1 is the elegant one, verified against source: `Bars.svelte:676` gates the fill on `:not(.wx-split)`, and `:915` actively transparentises. Because `splitTasks` is permanently `false` in the MIT build, **`wx-split` is an unclaimed hook here** — no contention risk.

Mechanisms 3 and 4 were written *knowing* mechanism 1 existed — the CSS literally spells `:not(.wx-split)` to step around it, and the comment at `:3635` names it.

**Stamping a class onto a SVAR-owned element — 4 near-identical attach + MutationObserver implementations in one 475-line file** (`markBarSplit`, `markBarDateStatus`, `markBarOverridden`, `colorCalendarItemBar`). Two walk via `closest`, one via `parentElement`; two re-assert on mutation, two don't (a latent bug — they silently lose their mark on `update-task`). The JSDoc says *"exactly as markBarSplit does"* — an explicit acknowledgement of the copy. There is no shared primitive.

**Publishing a colour — 5 routes**, reconciled only by a hand-maintained fallback chain repeated verbatim **9 times**:
`var(--og-bar-fill, var(--og-ghost-fill, var(--wx-gantt-task-color, #3d8de6)))`

---

## Roadmap

Ordered by (hours saved per future change) ÷ (effort). Each tier is independently shippable.

### Tier 0 — shipped defects · hours
| | Item | Effort |
|---|---|---|
| 1 | **D1** — correct the two legend rows | minutes |
| 2 | **D2** — fix the tooltip prop shape + add the missing test | ~1 h |

### Tier 1 — the two mechanisms that generate the hours · ~4 days
| | Item | Payoff |
|---|---|---|
| 3 | **Promote `test/probe/` to a real gate.** Un-label it as a spike, wire `probe:svar` into CI, move bar-visual regressions into it. Keep WDIO for Obsidian integration — writes, menus, Bases config — which is what it is for. | Replaces hundreds of WDIO lines with tens; turns a full-Obsidian inner loop into seconds. The maintainer's own report states a verification loop over five minutes is a design defect. |
| 4 | **Extract three cohesive concerns out of `GanttContainer.svelte`:** the diff-sync engine (`:1044-1329`) into the existing `ganttSyncCoordinator.ts`; the 9 `api.intercept` registrations into `wireSvarInterceptors(api, deps)`; the 1,440-line `<style>` into `src/bases/styles/*.css` split by concern. | Drops the file below ~1,600 LOC; makes two of the three unit-testable; ends the merge-contention monopoly. Behaviour-neutral, independently reviewable slices. |

### Tier 2 — reuse instead of imitate · ~3 days
| | Item | Deletes |
|---|---|---|
| 5 | **One `stampOnHostBar({ token, observeStyle })` primitive**; rewrite all four callers. | Half a day, jsdom-unit-testable, fixes the two non-re-asserting variants. |
| 6 | **Re-seat the zigzag and the swapped diagonal on `wx-split`.** The tooth-depth fitting exists *only* because host padding can widen the border box; under `wx-split` there is no host padding, so `fitToothDepth`, `measureSurvivingBorder`, `countTornSides` and the progress-wrapper re-pinning all disappear. | **~180 CSS + ~70 TS lines; ~50 of 71 `!important`s; the observer's `style` filter.** |
| 7 | **Define the fill chain once** as `--og-effective-fill` on `.wx-bar`; have all 9 sites read it. | ~2 h, mechanical, screenshot-verifiable under Tier 1. |

**Caveat on #6:** adopting `wx-split` changes selection/link-handle styling slightly (handles take `--wx-gantt-task-border-color` instead of `inherit`), and its effect on host hover/focus outline was reasoned about, not run. This needs the Tier-1 probe harness first — which is why Tier 1 precedes Tier 2.

### Tier 3 — remove the amplification · ~2–3 days
| | Item | Payoff |
|---|---|---|
| 8 | **Promote `visualSemantics.ts` to a semantic descriptor registry** — one record per semantic holding `{ id, classToken, appliesWhen, legendRow, sample }`, with `ganttSync`, `BarContent` and `legendCatalog` *deriving* from it. | Cuts the 6–8-file change surface to 2–3 and makes defect D1 structurally impossible. |
| 9 | **Rebind `--wx-gantt-task-color / -fill-color / -font-color / -border` per treatment class** instead of emitting literal declarations with `!important`. Custom properties on the bar element win by inheritance, with no specificity fight. | `barTreatment.ts` is 887 LOC / 13 commits — the worst churn×LOC of anything substitutable. Deletes most of the `!important` layer and the commentary explaining it. |

### Tier 4 — cheap cleanups · ~half a day
- Delete `PropertyMappingService.ts` (289 LOC) and `rfcMapping.ts` (192 LOC) — **zero importers in `src/`**, both kept green by live unit tests proving code nobody runs. `PropertyMappingService` also declares a competing 3-member `dateStatus` union against the canonical 5-member one.
- Retire `datestatus-flagged` from the task-type registry — stamped on every date-status bar, multiplying the registry combinatorially against SVAR's **linear per-bar scan**, with no production CSS rule at all.
- Delete the dead scroll-reset at `GanttContainer.svelte:2118-2135` — a 200 ms timeout against six selectors, **three of which do not exist in SVAR 2.7.0**.
- Rename the legend's `.wx-bar` / `.wx-progress-*` re-declarations to `og-*`; they duplicate SVAR's CSS on non-SVAR DOM and will drift on any SVAR restyle.
- Move `scheduler.ts`, `calendarWatch.ts`, `checklistProgress.ts`, `types/bases-entry.ts` out of `bases/` into a neutral location — they are the sole cause of six `datasource → bases` dependency inversions, and they block the cheap calendar-controller extraction the project wants to keep open.

### Deferred — spike first, no commitment
- **`flexgrow` on the name column** would remove ~90 LOC of grid-width restore bookkeeping across the highest-churn file, but forces a flex-sized name column and complicates per-column width persistence.
- **Underused API worth evaluating:** header filters (reachable, unused), `HeaderMenu` for column show/hide, `Tooltip.resolver` (the supported route to link tooltips), `getDiffer` (the *public* form of the private `_scales.diff` we reach into — a better degrade path than disabling split rendering), `cellHeight`/`scaleHeight` as props rather than mirrored constants, `lib-dom`'s `calculatePosition` and `hotkeys` versus our hand-rolled legend placement and raw keydown capture.

---

## Explicitly not recommended

**A rewrite.** The domain core is sound: `src/controller/**` has no upward dependencies; `segmentLayout.ts` is pure and unit-tested; the 1,109-LOC ICS source has *one commit* — large but stable, i.e. correctly factored. The debt is concentrated entirely in the SVAR-adaptation seam: `GanttContainer.svelte`, `register.ts`, `BarContent.svelte`, and the CSS binding them.

**Patching the MIT Pro gate.** Standing rule, unchanged.

---

## Unverified — flagged rather than asserted

- Whether the 52 `!important`s in the toggle-icon block are load-bearing. `.wx-toggle-icon` is styled in `@svar-ui/svelte-grid`, which was not read.
- The effect of `wx-split` adoption on host hover/focus outline — reasoned, not run. Gate on Tier 1.
- `GanttContainer.svelte:3727` claims SVAR writes `cursor` inline on hover. Only static rules were found (`Bars.svelte:661`, `:775`). The `!important` is still justified by specificity; the stated reason is wrong.
