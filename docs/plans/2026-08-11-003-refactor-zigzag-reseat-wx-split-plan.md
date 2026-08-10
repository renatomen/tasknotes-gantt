---
title: "refactor: Re-seat the zigzag on wx-split"
date: 2026-08-11
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# refactor: Re-seat the zigzag on wx-split

## Summary

The zigzag (torn-edge) date-status cue is painted today on an **opaque host bar**: `content-box` clipping plus per-side host padding open the notches, and every other surface is individually re-pinned above the cut body — plus ~63 lines of per-bar JS (`fitToothDepth`, `measureSurvivingBorder`, `countTornSides`) that exist *only* because host padding widens the border box, and a `style`-attribute MutationObserver that re-fits the tooth depth on every SVAR width rewrite (audit Tier-2 #6).

Re-seated, a torn bar adopts SVAR's own split rendering: `wx-split` makes the host transparent by the library's rule (no padding, no clip, no surviving-border arithmetic), the `.og-bar-body` paints the body itself from `--og-effective-fill` (#414's variable, published for exactly this consumer) under a teeth+middle mask at **fixed 4px depth**, and narrow bars are held by the per-surface `min(depth, ceiling)` that already exists. Deleted: the geometry trio, the `style` observer filter, and the host-paint rule family (clip, padding, torn-side border suppression, padding-compensating re-pins). The teeth+middle masks on the progress wrapper, replicated hatch, and piece surfaces **survive** — they cut paint that would otherwise fill the notches back in, under either mechanism.

**Sequencing note (recorded deviation from the presented queue):** Tier-2 #5 (`stampOnHostBar`) was queued before #6, but #6 deletes the `observeStyle` half of what #5 would extract. Reordered so each PR strictly reduces complexity; #5 follows as a trivial `{token}` spine extraction. The audit's caveat "needs the Tier-1 probe harness first" is satisfied: `npm run probe:svar` is CI-gated since #405.

**Scope boundary:** the swapped diagonal is SUPERSEDED (validation-badge slice, `docs/backlog.md` "Schedule validation") — do not re-seat or resurrect it. `datestatus-flagged`/`datestatus-swapped` (plain, non-torn) are untouched.

---

## Bar-state matrix (the design in one table)

| Torn bar also… | Split? | Body (`.og-bar-body`) | Edge cut carried by |
|---|---|---|---|
| plain (no pieces) | yes — stamped by the token observer | painted (fill var), teeth+middle mask | body + progress wrapper (+ replicated hatch) |
| ghost runs (stretch) | yes — already, via `markBarSplit` | **not rendered** | outermost piece masks (unchanged) |
| occupancy, envelope=true | yes — already, via `markBarSplitWhen` | **not rendered** | outermost piece masks (unchanged) |
| occupancy, envelope=false (overlay) | yes — stamped by the token observer (was opaque-host) | painted — it *is* the plain span the overlay pieces sit on | **wrapper-level** full-span mask via a new `og-occupancy-overlay` class on `.og-ghost-runs`; the piece-first/last cut rules exclude overlay wrappers (a recorded piece's edge is rarely the bar's — cutting it would grow mid-bar teeth) |

---

## Requirements

- **R1** — A bar whose `custom.dateStatusToken` is a torn token carries `wx-split` alongside the token, stamped and re-asserted by the **same** MutationObserver that stamps the token (one mechanism, two classes — never a second imitation observer). Teardown removes both. **Co-ownership:** on dual-mechanism bars (torn + stretched/enveloped) `wx-split` is also owned by `markBarSplit`'s observer; each owner's teardown may remove it and must tolerate the surviving owner re-asserting it (contains-guarded adds, no cross-disconnect, no "stronger removal" fix).
- **R2** — The painted torn body (plain + overlay rows of the matrix) uses `background-color: var(--og-effective-fill)` with a teeth+middle mask; depth is `min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling))` written at each use site (the documented declaring-element `min()` trap forbids hoisting). The body renders **only** in those two branches — an opaque body under ghost/envelope pieces would flood the piece gaps and drown the 15% blocked ghosts. Torn bars also inset `.wx-content` by the same `min()` on each torn side (host padding used to provide this; without it the label floats over the notches).
- **R3** — Every fill the old `background-color: inherit` body captured must reach `--og-effective-fill`: `stripBodyRule` and the parent-role body overrides in `src/bases/barTreatment.ts` currently paint bare `background-color` without threading `--og-ghost-fill` — thread it, or torn strip-mode and torn parent bars change colour. The torn strip bar's 1px outline (killed host-side by `.wx-bar.wx-split { border: 0 }`) moves to the body element so it survives and participates in the cut.
- **R4** — Progress: SVAR emits `.wx-progress-wrapper` for imperative splits; it is hidden today by **our own** rule. That rule keeps hiding it for piece-bearing split bars and stops hiding it for torn piece-less bars (scope on torn token AND no `> .og-ghost-runs` — `:has()` or a template class). The unhidden wrapper **keeps** its teeth+middle mask (an unmasked wrapper's `.wx-progress-percent` would repaint the notches) and keeps a z-index above the body: the body is emitted after the wrapper in SVAR's DOM order, so without the existing z-index rule the body paints over the progress. (Deviation from the audit's "re-render progress itself" sketch, recorded: rule-scoping reuses SVAR's wrapper; a template re-render would imitate it.)
- **R5** — Deleted outright: `fitToothDepth`, `measureSurvivingBorder`, `countTornSides`, `ZIGZAG_TOOTH_DEPTH_PX`, `ZIGZAG_TOOTH_MAX_WIDTH_SHARE`, per-bar `--og-zigzag-depth` writes, the `['class','style']` observer filter, and the host-paint rules: `background-clip`, host padding, torn-side host border suppression, and the `left:0/top:0` halves of the re-pins (their z-index halves survive per R4). The `:not(.wx-split) > .og-ghost-runs` selector lines are retargeted to `.og-occupancy-overlay` per the matrix, not deleted.
- **R6** — Hover/selection: SVAR guards its hover shadow and selected border behind `:not(.wx-split)`, and our split rule zeroes the border — so torn bars **would** lose hover/selection cues deterministically. Decided here, not discovered mid-flight: torn split bars get scoped rules restoring the cues from SVAR's own variables (`box-shadow: var(--wx-gantt-bar-shadow)` on hover and on `.wx-selected`). U3 screenshots verify the decided cue; the probe pins the values.
- **R7** — User-visible semantics survive: which bars carry which state token; torn bars keep ordinary fill/progress/label colours (now via R3's threading); only swapped is flagged orange; row shows through the notches; single-strength translucent fill; notch stays open under an edge-reaching occupancy piece; indicators-off renders no body and no tokens; stamp survives class-list rewrites and re-stamps on date change. Pins that read **host** paint/borders/hover to prove these are mechanism-coupled in implementation and move to U2's rewrite set (AE1 ordinary-fill reads host `backgroundColor`; the hover assertion reads the host shadow; the translucent-fill test injects a host background the new body ignores — rewrite to inject via `--og-ghost-fill`).
- **R8** — Narrow bars: a one-day placeholder at coarse zoom narrower than two teeth keeps a solid middle via the per-surface ceiling; no JS measures widths; wide-bar teeth stay exactly 4px deep, 8px period.
- **R9** — The legend torn swatch is unaffected (it depends only on the `--og-zigzag-*` custom properties, which keep their names and meanings); its probe stays green as-written.

---

## Key Technical Decisions

- **KTD1** *(session-settled: user-approved — the audit roadmap item)* — Reuse SVAR's split transparency instead of fighting the host's paint.
- **KTD2** — One observer stamps both classes on a torn bar; unstamp is co-owned and tolerant (R1).
- **KTD3** — Progress via scoping our own hide rule + surviving masks, not template re-implementation (R4).
- **KTD4** *(session-settled: user-directed — screenshot rule)* — Every visual claim (unchanged wide-bar teeth, narrow-bar solid middle, torn strip outline, hover/selection cue, progress above body, overlay composition) is verified with rendered screenshots viewed.
- **KTD5** — `--og-zigzag-depth: 4px` at the host level is the single authority; nothing writes it per-bar. Width-budget e2e helpers die with the mechanism.
- **KTD6** — The overlay case joins the split world rather than keeping the opaque-host mechanism alive for one branch: the body IS the plain span, wrapper-level cut, piece cuts excluded (matrix row 4). One mechanism total, or the deletion payoff evaporates.

---

## Implementation Units

### U1. Stamp torn bars split; paint body + progress under it

**Goal:** all four matrix rows render correctly split; geometry JS deleted.
**Files:** `src/bases/BarContent.svelte`, `src/bases/barTreatment.ts`, `src/bases/GanttContainer.svelte` (CSS), `test/unit/barTreatment.test.ts`.
**Approach:** token observer stamps both classes (R1); body rendered only in plain + overlay branches, `og-occupancy-overlay` class on the overlay wrapper (R2/matrix); thread `--og-ghost-fill` through `stripBodyRule` + parent-role rules with unit tests (R3); CSS per R2/R4/R5/R6.
**Execution note:** red-first: extend `test/unit/barTreatment.test.ts` with the threading expectations before touching the rules; mechanism-coupled e2e goes red en masse here and is rewritten in U2, not patched piecemeal.
**Test scenarios:** barTreatment unit tests pin `--og-ghost-fill` in strip/role rule output; jest suite green.

### U2. Rewrite the mechanism-coupled e2e pins

**Goal:** `gantt-date-handling.e2e.ts` pins the NEW mechanism as tightly as it pinned the old.
**Files:** `test/specs/gantt-date-handling.e2e.ts`, `test/specs/gantt-calendar-stretch.e2e.ts` (only if the torn-strip assertions read host paint).
**Approach:** rewrite `readZigzag`/width-budget helpers and the mechanism tests: host transparent + no padding/clip; body masked teeth(+teeth)+middle at fixed `4px 8px` with ceiling-held narrow bars; AE1 retargeted at the body; hover/selection asserting R6's restored cues; translucent-fill driven through `--og-ghost-fill`; "cuts teeth once on a never-split host" inverts to torn ⇒ split; delete border-arithmetic/re-fit tests with their mechanism (KTD5). Add: a **mid-bar recorded-piece overlay** scenario (wrapper cut, no mid-bar teeth) and **token-cleared-while-stretched** (co-ownership, R1). Keep genuinely mechanism-free pins byte-identical (token mapping, flagged counts, indicators-off, stamp survival, notch pixel tests).
**Test scenarios:** as listed; each rewritten assertion pins an expected value, not an absence.

### U3. Screenshots + probe pins for the decided styling

**Goal:** KTD4 discharge; the R6 cue and every visual claim seen and pinned.
**Files:** `test/probe/` (torn split bar under the real chart stylesheet), `docs/media/` if the demo changes.
**Approach:** probe wide/narrow torn bars, torn strip (non-stretched) outline, torn overlay composition, hover/selected cues; screenshot each, view each. Probe assertions pin handle/selection/hover values against SVAR bumps.
**Test scenarios:** probe pins for hover shadow, selected cue, link-handle colour on torn split bars.

---

## Verification Contract

Full jest; `npm run probe:svar`; e2e: `gantt-date-handling.e2e.ts`, `gantt-calendar-stretch.e2e.ts`, `gantt-inferred-date-drag.e2e.ts`, `gantt-time-estimate.e2e.ts`, `gantt-legend.e2e.ts`; legend probe unchanged. Screenshots viewed for every KTD4 claim. Grep gates: `fitToothDepth|measureSurvivingBorder|countTornSides|ZIGZAG_TOOTH_DEPTH_PX|ZIGZAG_TOOTH_MAX_WIDTH_SHARE` return nothing under `src/`; zero `background-clip`/host-padding/torn-side-border-suppression rules remain in the zigzag block. (No raw `!important`-delta gate: the surviving masks carry most of the block's weight by design — the honest gate is the named rule shapes, not a count.)

## Definition of Done

All units merged behind green CI as one PR; R1–R9 hold; residual record written; deviations (sequencing, R4 progress approach, R6 restored cues, KTD6 overlay decision) recorded in the PR body.

## Deferred to Implementation

- Exact selector/class mechanics for the overlay wrapper cut (template class vs `:has()`) — decide in U1 by what the piece-cut exclusion reads most simply.
- Replicated-hatch third mask layer on torn replicated bars: composes with teeth+middle as today's split pieces do; verify in U3 screenshots.

## Scope Boundaries

- No swapped-diagonal work (SUPERSEDED — validation slice owns inverted dates).
- No `stampOnHostBar` extraction here (Tier-2 #5 follows).
- No change to `datestatus-flagged`/`datestatus-swapped` styling, the legend catalogue, or token derivation in `datePolicy`/`ganttSync`.
