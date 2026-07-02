---
date: 2026-07-02
topic: gantt-bar-color-icon-treatments
---

# Gantt Bar Color & Icon Treatments Requirements

## Summary

Give users per-view control over how Gantt task bars are colored and whether a
status/priority icon is shown, via **three independent** per-view settings:

- **Bar Color Mode** — `Fill` (color the whole bar) or `Strip` (a colored accent strip
  on the bar's left edge; body stays neutral).
- **Color Source** — `Default` (SVAR/theme default, no TaskNotes coloring), `By Status`
  (TaskNotes status color), `By Priority` (TaskNotes priority color), or `Obsidian Theme`
  (colors derived from the active Obsidian theme so the Gantt adapts to any theme).
- **Task Icon** — `None`, `Status` (the status icon), or `Priority` (the priority icon).
  Fully independent of the color source: e.g. Fill-by-theme with a Priority icon is valid.

This generalizes today's always-on "status fill" (U5) into an opt-in, configurable system,
and adds priority as a first-class coloring/icon dimension.

## Problem Frame

Today, bars are **always** filled by TaskNotes status color whenever a status has a
configured color (the U5 feature in `statusColor.ts`). Users have no way to turn that off,
choose priority instead, use a lighter "strip" accent, show an icon in the bar, or have the
bar adapt to their Obsidian theme. Color is hard-wired to one source (status) and one
treatment (full fill), and icons are absent entirely.

The goal is user control without sacrificing the architectural qualities the current
implementation has: a pure, testable color module; declarative, virtualization-safe CSS;
and no hand-rolling of behavior SVAR provides natively.

## Key Decisions

- **Three independent settings, not a coupled mode.** Color mode, color source, and icon
  are orthogonal; any combination is valid. The icon dimension is *not* derived from the
  color source (an earlier coupled model was rejected) — a user can color by theme yet show
  a priority icon.

- **Route each concern to its most-native SVAR seam** (the project's "don't hand-roll what
  SVAR does natively" rule):
  - **Fill color** → SVAR custom `taskTypes` + scoped CSS (already the pattern in
    `statusColor.ts`/`ganttSync.ts`; `.wx-task.<customType>` is SVAR's documented coloring
    hook). Generalized to priority + theme.
  - **Icon chip** → SVAR's `taskTemplate` prop (the *only* native seam for content *inside*
    a bar) plus Obsidian `setIcon`. Post-render DOM injection was rejected as hand-rolling
    around SVAR's virtualization.
  - **Left strip** → a CSS `::before` accent on `.wx-bar` (SVAR has no native strip concept,
    so this is a legitimate hand-roll; consistent with existing `og-replicated`/`og-context`
    cue pseudo-elements).

- **Do NOT replace SVAR's whole bar content just to add an icon.** `taskTemplate` replaces
  `.wx-content`; engaging it for *every* bar would force us to re-implement and perpetually
  re-sync SVAR's internal content structure (text, `wx-text-out`, milestone handling). The
  template is engaged **only when `Task Icon ≠ None`**; the `None`/`Fill` path stays pristine
  SVAR (zero added risk on the default path).

- **Icons delegate entirely to Obsidian `setIcon` — no hardcoded Lucide knowledge.**
  TaskNotes renders status/priority icons via `setIcon(el, config.icon)`
  (`taskCardPrimaryIndicators.ts`), which resolves against Obsidian's whole icon registry
  (Lucide *plus* any plugin-registered icons). We mirror that exactly, so we're correct
  regardless of the icon name's origin and never bundle/parse an icon set.

- **No API "default icon"; mirror TaskNotes' colored-dot fallback.** When a status/priority
  has no configured `icon`, TaskNotes renders a colored dot (border = config color), not a
  fallback glyph. We do the same: `icon` present → glyph in the chip; absent → colored dot.

- **Default is `Default` / `Default` / `None`** — neutral SVAR bars out of the box; coloring
  and icons are opt-in per view. This is a deliberate change from today's always-on status
  fill; existing views lose automatic fills on upgrade until reconfigured. Acceptable while
  the plugin is `0.1.0-beta`, but **must be called out in release notes**.

- **Companion-gated sources degrade silently.** `By Status`/`By Priority` (color and icon)
  require the TaskNotes companion palette. In standalone (Bases-only) mode or when the
  palette is empty, they degrade to `Default` (neutral bar) / no chip — no error, no inert
  controls.

- **Color resolution stays a pure, unit-tested module** (`barTreatment.ts`), dependency-free
  like `statusColor.ts`, so the full Mode × Source × values matrix is testable in isolation.
  Data adapters continue to only *extract* raw values; all coloring/formatting is view-layer.

## Requirements

**Settings (per-view Bases view options)**

- R1. Three new per-view options on the Gantt view, persisted via `config.get`/`set` and read
  through pure `read*` helpers in `viewOptions.ts` (mirroring existing options):
  - `tngantt_barColorMode`: dropdown `fill` | `strip`, default `fill`.
  - `tngantt_barColorSource`: dropdown `default` | `status` | `priority` | `theme`, default `default`.
  - `tngantt_barIcon`: dropdown `none` | `status` | `priority`, default `none`.
- R2. All three settings are independent; any of the 2×4×3 combinations is valid and produces
  a coherent result.
- R3. `tngantt_barColorMode` has a visible effect only when `tngantt_barColorSource ≠ default`.
  (`strip` + `default` yields a neutral bar with no visible strip — a harmless no-op.)

**Color rendering**

- R4. `source = status`: each bar whose task has a status with a configured color takes that
  color as its fill (`mode = fill`) or left strip (`mode = strip`). This reproduces today's
  status-fill behavior when the settings are `fill`/`status`.
- R5. `source = priority`: same as R4 but keyed on the task's priority and the priority palette.
- R6. `source = theme`: bars take colors derived from Obsidian theme CSS variables (R11), with
  distinct parent and child roles, re-tinting live when the Obsidian theme changes (no
  re-render required — variables are late-bound).
- R7. `source = default`: no plugin coloring; bars render in the SVAR/theme default (pristine).
- R8. Coloring is emitted as a generated, scoped stylesheet (the existing `<style data-og-*>`
  injection) with one rule per present value — declarative and virtualization-safe; no
  per-bar inline styles or components for the color path. Fill uses `background-color`; strip
  uses a `.wx-bar.<slug>::before` left accent while the body keeps default styling.

**Icon rendering**

- R9. `icon = status` / `icon = priority`: each bar shows a neutral chip (left of the text)
  containing the status/priority icon rendered via Obsidian `setIcon`; when the value has no
  configured icon, the chip shows a colored dot (config color) instead — mirroring TaskNotes.
  The icon source is independent of the color source.
- R10. `icon = none`: no chip; `taskTemplate` is not engaged and bars render as pristine SVAR.
- R10a. When the icon chip is engaged, the bar's text and all existing `.wx-content`/date-status
  CSS hooks are preserved (the template renders a faithful `.wx-content`); progress fill/marker
  are unaffected.

**Obsidian-Theme colors (hardcoded defaults for now)**

- R11. Theme-source colors reference Obsidian CSS variables:
  - Parent bars: fill/strip color `var(--interactive-accent)`, text `var(--text-on-accent)`.
  - Child bars: `color-mix(in srgb, var(--interactive-accent) 28%, var(--background-primary))`
    (a lighter tint of the same accent), text `var(--text-normal)`.
    Fallback if `color-mix` is undesirable: `var(--background-secondary-alt)`.
  - In `strip` mode, the strip takes the accent and the bar body stays `var(--background-secondary)`.
  A future enhancement may expose the variable choice; for now it is hardcoded.

**Data layer**

- R12. `SourceTask` gains `priority: string | null` (raw value, no formatting).
- R13. Palette types gain an optional `icon?: string` (the `setIcon` name); add a
  `PriorityColor` type and `DataSource.getPriorityColors?()` mirroring `getStatusColors`.
- R14. `TaskNotesSource` reads `task.priority`, adds `getPriorityColors()` from
  `api.catalog?.priorities?.() ?? api.model?.config?.()?.priorities` (guarded), and adds
  `icon` to the existing status-color mapping. `CompositeSource` delegates the new accessor.
  **The exact priority accessor MUST be verified against the installed TaskNotes `main.js`
  before implementation** (the guardrail that caught the historical status-palette API-path
  bug); if unavailable, `By Priority` simply degrades to `default`.
- R15. `BasesSource` exposes no palette, so `status`/`priority` sources degrade to `default`
  in standalone mode.

**Coexistence & migration**

- R16. Date-status indicators (`datestatus-flagged`) are unchanged and coexist: fill remains
  `background-color !important` (the established status/date-status coexistence rule), the
  strip is a `::before`, and date-status uses border/text/progress — no conflict.
- R17. Instance cues coexist: `og-replicated` uses `::after` (no collision with the strip's
  `::before`); `og-context` opacity still applies.
- R18. Release notes call out that bar coloring is now opt-in per view (existing views lose
  automatic status fills until `source = status` is set).

## Key Flows

- F1. Color bars by priority as a strip
  - **Trigger:** User sets Mode = `Strip`, Color Source = `By Priority` in the view options.
  - **Steps:** Priority palette + per-task priority flow through the data layer; `barTreatment.ts`
    assigns each bar a priority-slug class and emits `.wx-bar.<slug>::before` strip rules; bar
    bodies stay neutral with a colored left accent.
  - **Result:** Every task with a priority shows its priority color as a left strip; tasks with
    no priority stay neutral.

- F2. Show a status icon while coloring by theme
  - **Trigger:** User sets Color Source = `Obsidian Theme`, Task Icon = `Status`.
  - **Steps:** Bars take accent-based theme fills (parent/child roles); `taskTemplate` engages
    and renders a neutral chip with the status icon via `setIcon`; text preserved in `.wx-content`.
  - **Result:** Theme-adaptive bars, each with a status icon chip; switching Obsidian theme
    re-tints bars live.

- F3. Standalone (no TaskNotes) with a companion-gated source selected
  - **Trigger:** User has `source = status` but TaskNotes is absent / palette empty.
  - **Steps:** No palette → `barTreatment.ts` resolves to `default`; no `taskTemplate` engaged.
  - **Result:** Neutral SVAR bars, no error, no inert controls.

- F4. Upgrade an existing view (migration)
  - **Trigger:** A user with today's always-on status fills upgrades to this version.
  - **Steps:** New defaults (`default`/`default`/`none`) apply to views that never set them.
  - **Result:** Bars render neutral until the user opts into `source = status`; release notes
    explain the change.

## Architecture

- **New pure module `bases/barTreatment.ts`** — absorbs and generalizes `statusColor.ts`.
  Given `(mode, source, statusPalette, priorityPalette, instances)` it returns the per-bar
  class each instance carries (status slug / priority slug / `og-parent` role for theme) and
  the generated stylesheet (fill `background-color` or strip `::before` rules; theme rules using
  CSS variables). Dependency-free (no Obsidian/Svelte); unit-tested in isolation.
- **New `bases/BarContent.svelte`** — the `taskTemplate` component; renders a faithful
  `.wx-content` plus the neutral icon chip from `data.custom.barIcon`, using `setIcon`.
- **`ganttSync.ts`** — folds the barTreatment class into the SVAR `type` string (reusing
  `buildStatusTaskTypes`-style stable registration), and attaches `custom.barIcon =
  { iconName, color } | { dotColor }` computed from the icon source.
- **`GanttContainer.svelte`** — injects the generated stylesheet (existing mechanism), passes
  `taskTemplate={BarContent}` to `<Gantt>` only when `icon ≠ none`, and hosts the chip/strip CSS.
- **`viewOptions.ts` / `register.ts`** — the three new options + `read*` helpers + wiring.
- **`datasource/types.ts`, `TaskNotesSource.ts`, `CompositeSource.ts`** — priority + icon data.

## Testing

Test-first (red→green→refactor), per the project's testing gate.

- **Unit — `barTreatment.ts`:** full Mode × Source × present-values matrix → correct classes and
  generated CSS; strip vs fill rule shape; theme parent/child rule emission; empty-palette →
  degrade-to-default. Mirrors `statusColor.test.ts`.
- **Unit — `viewOptions`:** the three new `read*` helpers (defaults, coercion/normalization).
- **Unit — `TaskNotesSource`:** `getPriorityColors()` (catalog path, model-config fallback,
  throwing → `[]`, icon mapping) and `priority` in `toSourceTask`. Mirrors the status tests.
- **Unit — `ganttSync`:** priority-slug / parent-role class composition and `custom.barIcon`
  attachment.
- **e2e (WebdriverIO, real Obsidian):** a focused `gantt-bar-treatments` spec (or extend
  `gantt-status-coloring.e2e.ts`) asserting fill+status parity, strip+priority `::before`, an
  icon chip present, and `none` = pristine. Kept at the fastest reliable level (controller
  `getInstances` + DOM assertions), not redundant e2e.

## Out of Scope (this iteration)

- User-selectable Obsidian theme variables (hardcoded parent/child defaults for now).
- Icon placement/style options beyond the study's neutral left chip.
- Coloring/icons on the TaskList view (Gantt view only).
- Making TaskNotes reltype-aware or any dependency-edge behavior (unrelated).
