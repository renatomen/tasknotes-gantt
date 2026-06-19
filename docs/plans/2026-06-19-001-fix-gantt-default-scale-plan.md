---
title: "fix: Honor the configured Gantt default scale"
type: fix
date: 2026-06-19
---

# fix: Honor the configured Gantt default scale

## Summary

Wire the Bases `defaultScale` view option into SVAR's initial zoom configuration, including the
existing Hours option, while preserving user-driven zoom across later data refreshes.

## Problem Frame

The Gantt view registers and persists a `defaultScale` option, but the render pipeline never reads
it. `GanttContainer.svelte` always passes SVAR a zoom configuration with `level: 3`, so Hours, Days,
Weeks, Months, and the declared `day` fallback all open at the same month/week level.

## Requirements

- R1. A newly loaded Gantt view opens at the scale selected by its `defaultScale` setting.
- R2. Missing or malformed settings fall back to Days, matching the registered option default.
- R3. Hours, Days, Weeks, and Months each map to a zoom level whose finest scale unit matches the
  selected value.
- R4. The default applies only during initialization; user-selected zoom remains unchanged across
  ordinary data refreshes.
- R5. Automated tests cover the scale mapping and the real Bases-config-to-render path.

## Key Technical Decisions

- **Build the zoom configuration in a pure helper:** this makes the option normalization, level
  mapping, and hour-level definition directly testable without mounting SVAR in Jest.
- **Carry the normalized setting through `GanttData`:** this follows the existing initial-only
  `gridWidth` pattern and keeps config access in `register.ts`.
- **Read the initial snapshot once:** `GanttContainer` builds the SVAR `zoom` prop from
  `initialData.defaultScale`, so later store refreshes cannot reset a user's zoom.
- **Retain the Hours option:** add a day/hour zoom level using SVAR's supported `hour` unit and
  `%H:%i` formatter instead of removing a visible setting.

## Implementation Units

### U1. Define and test the default-scale zoom contract

- **Goal:** Establish a validated mapping from the four view-option values to the existing zoom
  ladder plus a new hourly level.
- **Execution note:** Test-first.
- **Files:** `src/bases/zoomConfig.ts`, `test/unit/zoomConfig.test.ts`.
- **Patterns to follow:** the current zoom ladder in `src/bases/GanttContainer.svelte`; focused
  pure-helper tests such as `test/unit/gridColumns.test.ts`.
- **Test scenarios:** Months selects the quarter/month level; Weeks selects month/week; Days selects
  month/day; Hours selects day/hour; missing and invalid values select Days; every selected index
  exists in the returned level array.
- **Verification:** the focused unit suite fails before the helper exists and passes once all
  mappings and formats are defined.

### U2. Wire the view setting into initial rendering and cover the integration

- **Goal:** Read `defaultScale` at the Bases boundary and use it for the initial SVAR zoom
  configuration without changing refresh-time zoom preservation.
- **Dependencies:** U1.
- **Files:** `src/bases/register.ts`, `src/bases/types/gantt-view-data.ts`,
  `src/bases/GanttContainer.svelte`, `test/vaults/gantt-readonly/Gantt.base`,
  `test/specs/gantt-readonly-render.e2e.ts`.
- **Patterns to follow:** `getArrowMode()` and `getTableWidth()` in `src/bases/register.ts`;
  `initialData.gridWidth` in `src/bases/GanttContainer.svelte`; the hermetic read-only vault setup
  in `test/specs/gantt-readonly-render.e2e.ts`.
- **Test scenarios:** a fixture configured for Months renders a quarter/month header rather than the
  previous hard-coded month/week header; an unset option normalizes to Days in the unit contract; an
  ordinary data refresh does not reconstruct the zoom prop.
- **Verification:** the E2E assertion fails against the hard-coded level and passes after wiring;
  typecheck, unit tests, lint, local build, and the relevant E2E spec pass.

## Scope Boundaries

- Do not persist the user's current zoom as a new view setting.
- Do not reapply `defaultScale` on data refresh or override interactive zoom controls.
- Do not redesign the six existing year-through-day zoom levels beyond adding the missing hourly
  level.
- Do not change unrelated Bases view options.

## Risks & Dependencies

- SVAR treats a changed `zoom` prop reference as a store reinitialization. Building it once from the
  initial data snapshot is therefore load-bearing for R4.
- The integration assertion depends on SVAR's `.wx-scale` DOM classes, already used as accepted
  dependency selectors in the E2E suite.

## Sources & Research

- `src/bases/register.ts` registers `defaultScale` but does not read it in `buildGanttData()`.
- `src/bases/GanttContainer.svelte` hard-codes `zoomConfig.level` to `3` and passes that config to
  `<Gantt>`.
- `node_modules/@svar-ui/gantt-store/dist/types/types.d.ts` confirms `hour` is a supported scale
  unit.
- `node_modules/@svar-ui/svelte-gantt/src/helpers/prepareConfig.js` defines the default hour
  formatter as `%H:%i`.
