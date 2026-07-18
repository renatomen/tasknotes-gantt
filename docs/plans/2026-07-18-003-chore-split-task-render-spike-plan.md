---
title: Split-Task Render Spike - Plan
type: chore
date: 2026-07-18
topic: split-task-render-spike
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Split-Task Render Spike - Plan

## Goal Capsule

- **Objective:** Prove that SVAR-equivalent split-task rendering — spaced segments in one row — can be hand-rolled elegantly in a custom bar template, and produce a prototype the maintainer can look at.
- **Product authority:** Maintainer (Renato).
- **Execution profile:** Throwaway prototype. Runs in the existing isolated browser harness; no Obsidian, no plugin data pipeline. Layout math is written test-first; rendering is proved by DOM assertions plus a captured screenshot.
- **Landing:** Local commits only. No pull request.
- **Stop conditions:** Stop and surface if the segment DOM cannot be produced from a custom `taskTemplate` without modifying SVAR, or if positions cannot be computed from the exposed scale.
- **Open blockers:** None.

---

## Product Contract

### Summary

Render a task with a `segments` array as spaced sub-bars inside one row, matching SVAR's split-task DOM, from a custom bar template running against the MIT build. Prove it in the isolated harness and capture an image of the result.

### Problem Frame

SVAR's split-task is Pro-gated: the MIT build forces `splitTasks` off in the store's `init` and strips the Pro segment date-normalisation, so no config enables it (`docs/solutions/integration-issues/svar-pro-feature-render-support.md`). The plugin already owns the bar body via a custom `taskTemplate`, which is the seam a hand-rolled equivalent would use. Before committing to a production feature, the open question is simply whether that hand-roll is clean — or whether fighting SVAR's positioning and CSS makes it ugly.

### Requirements

- R1. A task carrying a top-level `segments` array of `{ start, duration }` renders one sub-bar per segment, spaced by the gaps between them, inside a single row.
- R2. The emitted DOM matches SVAR's split-task structure: a segments container, one indexed segment element per entry, per-segment progress, and the dashed connector spanning the bar.
- R3. Segment offsets and widths are computed from the live timeline scale, so they stay correct when the zoom changes.
- R4. The outer bar renders transparent so the segments are the visible pieces, without blanking the segments themselves.
- R5. The prototype produces a screenshot of a segmented bar for visual judgement.
- R6. The prototype runs without Obsidian, in the existing probe harness.
- R7. Only MIT-covered SVAR code is adapted, with its copyright and permission notice retained.

### Scope Boundaries

- No Obsidian: no Bases view, no fixture vault, no e2e.
- No plugin data path: no configured property, no `SourceTask`/`RenderInstance`/`ganttSync` changes, no `taskStateKey` work.
- No interaction: hover, tooltip, click, drag, resize, and editing are all out. The prototype emits the index attribute that would later enable them, and stops there.
- No production wiring: nothing ships into `src/` rendering paths.

### Success Criteria

- A segmented bar is visually indistinguishable from SVAR's split-task rendering of the same data.
- The hand-roll reads as a small, obvious piece of code — if it needs to fight SVAR, the spike has answered "not elegant".

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Segments live on the task's top-level `segments` field.** SVAR reads `task.segments` for its split class, its segment branch, and the store's layout recursion, so using the same field is what keeps a future Pro build a drop-in. A nested or side-channel field would break that.
- KTD2. **Width is derived from an end date, not from duration times cell width.** `cellWidth` is pixels per `lengthUnit` cell while `duration` is expressed in the store's separate `durationUnit`, so multiplying them is wrong off day granularity. Derive the segment end from start plus duration, then measure end against start in `lengthUnit`.
- KTD3. **Offsets are bar-relative.** The store rebases each segment against its parent bar, and SVAR's markup uses the value directly as `left` inside a relatively-positioned container. Subtract the bar's own offset to match.
- KTD4. **Positions are computed in the template from the reactive scale.** They depend on zoom, which changes after any sync, and the template already receives SVAR's `api`. Prefer store-supplied values if a build ever provides them.
- KTD5. **Copy the container CSS; inherit the segment CSS.** SVAR's `.wx-segments` container rules and the dashed connector live in `BarSegments.svelte`'s scoped block and will not apply to our markup, so they must be adapted. The `.wx-bar :global(.wx-segment)` rules in `Bars.svelte` do apply through the bar ancestor and come for free.
- KTD6. **The transparency rule must exclude segments.** Each segment element carries `wx-bar` itself, so a rule keyed on the bar would blank the segments too. Scope it to the bar that is not a segment.
- KTD7. **The prototype template stays Obsidian-free.** The probe config has no `obsidian` alias, and the plugin's real bar template reaches `obsidian` through its icon action, so the prototype uses a standalone template rather than importing the production one.

### Assumptions

- Segment display text is not exercised; segments render without text, as SVAR does when a segment carries none.
- Authored ranges are well-formed and inside the task's own span; out-of-span and malformed input are production concerns, not prototype ones.

### Sequencing

U1 → U2 → U3.

---

## Implementation Units

### U1. Segment layout math

- **Goal:** Convert a segment's start and duration plus the live scale into a bar-relative offset and width.
- **Requirements:** R1, R3.
- **Dependencies:** none.
- **Files:** `test/probe/segmentLayout.ts` (new), `test/probe/segmentLayout.test.ts` (new).
- **Approach:** A pure function taking the segment, the parent bar's offset, and the scale primitives. Derive the segment end from start plus duration in the duration unit, then measure both offset and width against the scale's difference function times cell width, mirroring the store. Subtract the bar offset so the result is bar-relative.
- **Execution note:** Write this test-first; it is pure arithmetic and the place a subtle unit mismatch would hide.
- **Patterns to follow:** the store's task-layout computation, whose formula this mirrors.
- **Test scenarios:**
  - A segment starting at the bar start yields a zero offset.
  - A later segment's offset equals the scaled difference from the bar start.
  - Width reflects the segment's span measured in the scale's length unit, not its raw duration number.
  - Doubling cell width scales offset and width together, within rounding.
  - Results are bar-relative, not timeline-absolute.
  - A zero-length segment yields a non-negative width.
- **Verification:** The layout tests pass, including the non-day length-unit case.

### U2. Hand-rolled segment bar template

- **Goal:** A standalone bar template that draws SVAR's split-task DOM for a task carrying segments.
- **Requirements:** R1, R2, R4, R6, R7.
- **Dependencies:** U1.
- **Files:** `test/probe/SegmentBar.svelte` (new), `test/probe/SegmentsProbeHost.svelte` (new).
- **Approach:** The template branches when the task carries segments, reads the reactive scale through the `api` prop SVAR passes it, computes each segment box via the U1 helper, and emits the segments container with one indexed segment element each plus per-segment progress and the adapted connector. The host mounts a raw SVAR chart with this template and a fixed-height wrapper. A local style block carries the adapted container rules and the transparency rule, scoped so it cannot match a segment element.
- **Execution note:** Adapt SVAR's `BarSegments` markup and its container CSS directly, retaining the MIT copyright and permission notice in the adapted file.
- **Patterns to follow:** `node_modules/@svar-ui/svelte-gantt/src/components/chart/BarSegments.svelte` for markup and CSS; `test/probe/SvarFeatureProbeHost.svelte` for the fixed-height mount and settle sentinel.
- **Test scenarios:** Covered by U3 — this unit is the component under test.
- **Verification:** The host mounts and a segmented task produces segment elements (asserted in U3).

### U3. Prove it and capture it

- **Goal:** Assert the rendered structure and produce a screenshot for visual judgement.
- **Requirements:** R1, R2, R4, R5, R6.
- **Dependencies:** U2.
- **Files:** `test/probe/segments-render.probe.ts` (new).
- **Approach:** Mount the host over a task with two spaced segments and assert the segment structure, count, ordering, and that segment boxes are spaced rather than contiguous. Assert an unsegmented control renders one ordinary bar with no segments container. Capture a screenshot of the segmented case to a results path for the maintainer to view.
- **Patterns to follow:** `test/probe/svar-features.probe.ts` for the mount-and-settle helper and results artifact.
- **Test scenarios:**
  - A two-segment task renders exactly two segment elements inside one row.
  - The segments carry ascending index attributes.
  - The second segment's offset exceeds the first segment's offset plus width, proving a visible gap.
  - The connector element is present behind the segments.
  - A partially complete segmented task shows progress on the earlier segment.
  - An unsegmented control renders one bar and no segments container.
  - The computed transparency rule does not match a segment element.
- **Verification:** The probe spec passes and a screenshot exists at the results path.

---

## Verification Contract

| Gate | Command | Applies to | Done signal |
|---|---|---|---|
| Layout math | `npm test` | U1 | Layout tests pass |
| Rendering | `npm run probe:svar` | U2, U3 | Segment DOM asserted; screenshot written |
| Typecheck | `npm run typecheck` | U1–U3 | No new errors |
| Lint | `npm run lint` | U1–U3 | Clean |

---

## Definition of Done

- A task with two spaced segments renders as two sub-bars in one row, with the outer bar transparent and the connector visible.
- A screenshot of that render exists for the maintainer to judge.
- The layout math is unit-tested, including a non-day length unit.
- Nothing under `src/` changed; the prototype lives entirely in `test/probe/`.
- Adapted SVAR markup and CSS retain the MIT copyright and permission notice.
- The maintainer can state whether the hand-roll reads as elegant.
- Work is committed locally; no pull request is opened.

---

## Sources / Research

- `docs/solutions/integration-issues/svar-pro-feature-render-support.md` — why split-task is unreachable in the MIT build.
- `node_modules/@svar-ui/svelte-gantt/src/components/chart/BarSegments.svelte` — the markup and container CSS being adapted.
- `node_modules/@svar-ui/svelte-gantt/src/components/chart/Bars.svelte` — the split class, the transparent-bar rule, and the `taskTemplate`-wins branch.
- The store layout function in `node_modules/@svar-ui/gantt-store/dist/index.js` — the date-to-pixel formula and the segment rebase.
- `test/probe/` — the existing isolated harness this spike extends.
- `docs/plans/2026-07-18-002-feat-split-task-segment-rendering-plan.md` — the full production feature, deferred until this spike answers the elegance question.
