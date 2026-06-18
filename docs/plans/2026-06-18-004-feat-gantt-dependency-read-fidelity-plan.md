---
date: 2026-06-18
plan_id: 004
type: feat
title: "feat: Gantt dependency read fidelity — render four reltypes + surface gap"
origin: docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md
status: active
milestone: "M1 Read fidelity"
tracking_issues: [81, 82]
---

# feat: Gantt dependency read fidelity — render four reltypes + surface gap

Milestone 1 of the RFC 9253 dependency epic (see origin: [docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md](docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md); GitHub epic #91, issues #81/#82). Read-only: no authoring, no cascade.

---

## Summary

Make the Gantt render all four TaskNotes/RFC 9253 dependency relationship types honestly and surface each edge's relationship type + gap (lag/lead) without opening the note. The read path already maps `reltype → SVAR link type`, but it **discards `gap` and the human-readable reltype** at the link-build step, and there is no place in the UI that shows them. This plan threads `gap` + `reltype` through the link model end-to-end, leans on SVAR's native anchor geometry to distinguish the four types, and surfaces reltype + gap through the **dependent task's tooltip** (SVAR has no native link tooltip).

---

## Problem Frame

In real vaults every dependency is `FINISHTOSTART` (TaskNotes' UI authors nothing else), but non-FS edges can already exist (HTTP API / hand-edited frontmatter), and the broader epic will soon create them. Today:

- `SourceLink`/`RenderLink` ([src/controller/InstanceExpansion.ts:81-101](src/controller/InstanceExpansion.ts#L81-L101)) carry only the SVAR `type` code. The `gap` and original `reltype` from `SourceDependency` are dropped when `buildSnapshot` builds the `SourceLink` ([src/controller/GanttController.ts:790-804](src/controller/GanttController.ts#L790-L804)).
- Nothing in the view shows a dependency's type or gap — a user cannot tell an FS edge from an SS edge, or see a `P1D` lag, without opening the note.

This is the founding doc's R16 "real dependency arrows," completed properly for read.

### Scope boundary

This plan is **Milestone 1 only**: render + surface (read). Link create/edit/delete (M2/M3), the scheduling cascade (M4), and the upstream TaskNotes reltype-aware change (UT) are out of scope.

---

## Requirements

Traced from the origin requirements doc:

- **R1** — Render each of the four reltypes with the correct SVAR anchor geometry (`FINISHTOSTART`→`e2s`, `STARTTOSTART`→`s2s`, `FINISHTOFINISH`→`e2e`, `STARTTOFINISH`→`s2e`) and a visually distinguishable result.
- **R2** — Read `gap` (ISO-8601 duration, e.g. `P1D`) into the render model and surface it, including lag/lead direction.
- **R3** — Reltype + gap are visible without leaving the Gantt.

Origin acceptance examples in scope: **AE1** (four types render distinctly), **AE2** (gap is visible).

---

## Key Technical Decisions

- **KTD1 — Carry `gap` + `reltype` on the link model; don't re-derive.** Extend `SourceLink`/`RenderLink` to carry `gap: string | null` and the human `reltype`, populated at the existing build site, so the view reads one coherent object. Re-deriving from the source graph in the view would duplicate the instance→source resolution `rewriteLinks` already does.
- **KTD2 — Distinguish the four types via SVAR's native anchor geometry; no custom per-type CSS in M1.** `e2s`/`s2s`/`e2e`/`s2e` already render with distinct start/end anchors. Per-type color/dash would require DOM-class hacks SVAR does not expose on links — deferred (see Scope Boundaries).
- **KTD3 — Surface reltype + gap through the dependent task's tooltip, not the link.** SVAR has no native link tooltip/label (only task tooltips via `data-tooltip-id`; link DOM exposes just `.wx-link`/`.wx-line`). The dependent task's tooltip is the native, low-risk surface: it lists incoming dependencies as "Blocked by <name> — FS, +1d". This makes R3 independent of any link-geometry trick.
- **KTD4 — Map `gap` onto SVAR's native `lag` for geometry, but treat it as best-effort.** SVAR link objects accept an optional `lag`; feeding it gives the arrow a visual offset. The exact `lag` unit/semantics is an execution-time unknown — so the **authoritative** gap surfacing is the tooltip (KTD3), and `lag` is a visual enhancement that, if it misbehaves, can be dropped without failing R2/R3.
- **KTD5 — Gap formatting is a pure, tested helper with a defined fallback.** ISO-8601 duration → compact human string (`P1D`→`+1d`, `PT4H`→`+4h`, negative → lead) lives in a dependency-free module mirroring `cascadeGate.ts`/`statusColor.ts`, so it is unit-testable without Obsidian/SVAR. **Fallback contract:** composite/exotic durations (e.g. `P1W2DT3H`) that the compact formatter doesn't reduce render as the **raw ISO string** suffixed verbatim (`… — FS P1W2DT3H`) — accepted as a rare-case UX cost rather than failing or hiding the edge. The fallback is part of the helper's spec, not deferred.
- **KTD6 — Encode `gap` in the link id so a gap-only change re-syncs.** Link ids are `source->target:type` ([src/controller/InstanceExpansion.ts](src/controller/InstanceExpansion.ts) `makeLinkId`), and `planLinkSync` is delete/add-on-id with no in-place update. A pure gap edit (same endpoints + same reltype→same SVAR `type`) would otherwise leave the id unchanged and never re-issue the SVAR link's `lag`. Including `gap` in the id makes a gap change a delete-old + add-new, consistent with how `type` changes already flow.

---

## Implementation Units

### U1. Thread `reltype` + `gap` through the dependency link model

- **Goal:** Stop dropping `gap` and the human `reltype`; carry both from `SourceDependency` to `GanttData.links` so the view can read them.
- **Requirements:** R2 (data path).
- **Dependencies:** none.
- **Files:**
  - `src/controller/InstanceExpansion.ts` — add `gap: string | null` and `reltype: DependencyRelType` to `SourceLink` and `RenderLink`; carry them unchanged through `rewriteLinks` (both `primary` and `all` modes).
  - `src/controller/GanttController.ts` — populate `gap` + `reltype` when building `SourceLink` in `buildSnapshot` (~:790-804); include the new fields in `sourceLinksEqual` (~:939) so a gap/reltype change is detected by diff-sync.
  - `src/datasource/types.ts` — no change (`SourceDependency` already has `reltype` + `gap`); referenced for the type import.
  - Tests: `test/unit/InstanceExpansion.test.ts`, `test/unit/GanttController.*.test.ts`.
- **Approach:** `SourceDependency` already carries `reltype` + `gap`; the loss is purely at the `SourceLink` projection. Keep the existing `type` (SVAR code) field and add the two new fields alongside it. The diff-sync equality check must compare the new fields or external gap edits won't re-render.
- **Patterns to follow:** the existing `SourceLink`→`RenderLink` carry-through; `sourceLinksEqual` structure.
- **Test scenarios:**
  - `rewriteLinks` preserves `gap` + `reltype` for a single instance (primary mode) and for duplicated instances (all mode).
  - All four reltypes carry through with the correct paired SVAR `type`.
  - A `gap` of `"P1D"` round-trips; a `null` gap stays `null`.
  - `sourceLinksEqual` returns false when only `gap` differs, and false when only `reltype` differs (so diff-sync fires).
- **Verification:** `GanttData.links` entries expose `gap` + `reltype`; unit suite green; `npm run typecheck` clean.

### U2. Render the four reltypes (with best-effort `lag`) and lock with e2e

- **Goal:** Confirm all four types render with correct anchors; feed `gap`→`lag` to the SVAR link; prevent regression with e2e coverage.
- **Requirements:** R1; AE1.
- **Dependencies:** U1.
- **Files:**
  - `src/controller/InstanceExpansion.ts` — `makeLinkId` must include `gap` in the id so a gap-only change is a distinct link (KTD6).
  - `src/bases/GanttContainer.svelte` — where the seeded/diff-synced links are handed to `<Gantt links=…>` (seed at ~:1048, diff-sync via `planLinkSync` ~:289), include `lag` derived from `gap` on the SVAR link object; ensure `type` continues to pass through.
  - `src/bases/ganttSync.ts` — the SVAR-link projection / `planLinkSync` (~:343-354): map `gap`→`lag`, carry `type`. No in-place link update exists, so the gap-in-id change (KTD6) is what makes a gap edit a delete-old + add-new.
  - `src/bases/dateGap.ts` (new) — pure ISO-8601-duration → SVAR `lag` number converter (parse `P1D`→`1` at day `durationUnit`), unit-tested independently of whether SVAR consumes it.
  - Tests: `test/unit/ganttSync.test.ts`, `test/unit/dateGap.test.ts` (new); e2e `test/specs/gantt-dependency-types.e2e.ts` (new).
- **Approach:** `RenderLink.type` is already correct, so type distinction is mostly verification. The `gap`→`lag` numeric conversion (KTD4) is isolated in a pure helper and asserted as a pure function — `lag`'s in-chart rendering effect stays a non-gating in-vault check (KTD3 makes the tooltip authoritative for gap, so a misbehaving `lag` does not fail R2/R3). The e2e mounts a fixture with one edge of each reltype and asserts each link renders; use `[data-id$="X.md"]`-style selectors (SVAR 2.7.0 prefixes string ids with `:` — see the SVAR upgrade learning).
- **Patterns to follow:** existing link seed + `planLinkSync` diff-sync; e2e selector conventions in `test/specs/gantt-date-handling.e2e.ts`.
- **Test scenarios:**
  - **Covers AE1 (type round-trip).** e2e: a fixture with `FINISHTOSTART`/`FINISHTOFINISH`/`STARTTOSTART`/`STARTTOFINISH` edges renders four links, each present in the DOM with its expected `type`/endpoints. (Automated scope is the type round-trip; perceptual distinctness of the anchors is a manual in-vault check — see Verification.)
  - Unit: a gap-only change (`P1D`→`P2D`, same endpoints + reltype) produces a different link id, so `planLinkSync` re-issues the SVAR link (F2 regression guard).
  - Unit (`dateGap`): `P1D`→`1`, `PT4H`→fractional/hour-unit value per the chosen `durationUnit`, `null`→no `lag`; pure-function assertions independent of SVAR.
  - Unit: `type` is carried verbatim to the SVAR link object for all four reltypes.
- **Verification:** e2e green; no regression in existing link e2e; in-vault on a mixed fixture, all four arrows visible **and** the implementer explicitly judges whether anchor geometry alone makes the four types perceptually distinguishable — if not, raise the deferred per-type styling (Scope Boundaries) rather than silently passing.

### U3. Surface reltype + gap via the dependent task's tooltip

- **Goal:** A dependent task's tooltip lists its incoming dependencies with relationship type + human-readable gap, satisfying "visible without opening the note."
- **Requirements:** R2, R3; AE2.
- **Dependencies:** U1.
- **Data-flow decision (resolves the link→task boundary).** SVAR's `Tooltip` content component receives the hovered **task** (`{data: ITask}`), but reltype/gap live on **links**. So the per-task incoming-edge summary must be precomputed and attached to the SvarTask: add `custom.incomingDeps: {reltype, gap, predecessorName}[]`, built in `buildSvarTasks` from a target-instance→edges lookup over the links from U1. Predecessor *names* aren't on the link (only ids/paths) — resolve them from the instance list `buildSvarTasks` already has. The new `custom.incomingDeps` **must** be folded into `taskStateKey` (`ganttSync.ts` ~:192-211) or an external gap edit won't trigger an `update-task` and the tooltip goes stale (same diff-sync trap as KTD6, on the task side).
- **Files:**
  - `src/bases/dependencyTooltip.ts` (new) — pure formatter: given a task's incoming edges (`{reltype, gap, predecessorName}[]`), produce the tooltip text (e.g. `Blocked by Draft docs — FS +1d`). Reltype→label map (FS/FF/SS/SF); reuses the `dateGap` formatter (U2) / KTD5 fallback. Sorts edges deterministically (alphabetical by `predecessorName`).
  - `src/bases/ganttSync.ts` — build the target→incoming-edges lookup and populate `custom.incomingDeps` in `buildSvarTasks`; add `incomingDeps` to `taskStateKey`.
  - `src/bases/GanttContainer.svelte` — wire a SVAR `Tooltip` (none today) whose content component reads `data.custom.incomingDeps` and renders via the formatter.
  - Tests: `test/unit/dependencyTooltip.test.ts` (new); extend `test/unit/ganttSync.test.ts` for the lookup + `taskStateKey` folding.
- **Approach:** Reuse SVAR's task-tooltip mechanism rather than inventing a link tooltip (KTD3). The formatter + lookup hold the testable logic; the Svelte `Tooltip` wiring is thin. **Empty state:** a task with no incoming edges injects **no** dependency section — the implementer must let the tooltip fall through to SVAR's native task tooltip or suppress it, never render an empty container (a blank hover target on every non-blocked task is a defect). **Accessibility (M1 minimum):** the reltype+gap summary must also be reachable without hover — expose it on keyboard focus via SVAR's focus path if available, else as an `aria-label`/`aria-describedby` on the task element. One explicit decision, no custom component required.
- **Patterns to follow:** pure-helper style of `src/bases/cascadeGate.ts` and `src/bases/statusColor.ts`; `custom`-field + `taskStateKey` pattern already in `buildSvarTasks`; SVAR `Tooltip` usage from the svar-svelte gantt skill.
- **Test scenarios:**
  - **Covers AE2.** Formatter: a `FINISHTOSTART` edge with `gap "P1D"` → label containing `FS` and `+1d`.
  - Formatter: each reltype maps to its short label (FS/FF/SS/SF).
  - Formatter: `PT4H` → `+4h`; a lead (negative duration, if TaskNotes emits one) → `-…`; `null` gap → type label only, no gap suffix; composite `P1W2DT3H` → raw-ISO fallback (KTD5).
  - Formatter: a task with multiple incoming edges lists each, sorted alphabetically by predecessor name (deterministic ordering — regression guard).
  - Formatter: a task with no incoming edges yields no dependency tooltip content (empty, not a blank container).
  - Lookup/sync: `custom.incomingDeps` is populated for a blocked task and folded into `taskStateKey` (a gap-only edit changes the key).
- **Verification:** hovering a blocked task in-vault shows its predecessors with type + gap; the same is reachable by keyboard focus; non-blocked tasks show no empty tooltip; formatter + lookup unit tests green.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- **Per-type visual styling** (color/dash per reltype beyond anchor geometry) — needs DOM-class hooks SVAR doesn't expose on links; revisit only if anchor geometry proves insufficient in-vault.
- **Link authoring** (create/edit/delete) — Milestone 2/3 (issues #83–#87).
- **Dependency cascade / scheduling** — Milestone 4 (issues #88–#90).
- **TaskNotes reltype-aware blocking** — upstream UT (renatomen/tasknotes#10).

### Outside this product's identity

- A plugin-owned dependency store (TaskNotes' `blockedBy` is system-of-record).

---

## Risks & Dependencies

- **SVAR `lag` semantics (low/contained).** The `lag` unit and whether it offsets geometry as expected is unverified. Mitigation: KTD3 makes the tooltip the authoritative gap surface; `lag` is a best-effort visual enhancement that can be dropped without failing R2/R3.
- **No existing SVAR `Tooltip` wiring (medium).** U3 introduces the first tooltip integration. Mitigation: the testable logic is isolated in the pure formatter; the Svelte wiring is thin and verified in-vault.
- **ISO-8601 duration variety (low).** TaskNotes gap is ISO-8601 (`P1D`, `PT4H`, possibly `P1W`/composite/negative). Mitigation: cover common forms (`D`/`H`/`W`, sign); treat exotic/composite durations as a graceful fallback (show raw string) rather than failing.
- **SVAR id `:`-prefix (known).** e2e selectors must use `[data-id$="…"]`; reuse the established pattern.
- **Diff-sync on two surfaces (resolved in-plan).** A gap edit must re-render through *both* paths: `sourceLinksEqual` (U1) fires the controller recompute, KTD6 (gap-in-link-id) makes `planLinkSync` re-issue the link, and `taskStateKey` folding `custom.incomingDeps` (U3) re-issues the task tooltip. Missing any one leaves a stale arrow or stale tooltip — each has an explicit regression test scenario.

---

## Deferred to Implementation

- Exact `gap`→SVAR-`lag` conversion (unit and whether to render `lag` at all) — decide against the installed SVAR 2.7.0 once `lag` behavior is observed.
- Precise SVAR `Tooltip` content wiring (component vs. `data-tooltip` attribute; 2.7.0 tooltip content `{api,data}` shape) — resolve while implementing U3.
- Whether the target→incoming-edges lookup is built in the controller, `ganttSync.ts`, or the component.

---

## Sources & Research

- Origin requirements: [docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md](docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md).
- Link model + build site: [src/controller/InstanceExpansion.ts](src/controller/InstanceExpansion.ts), [src/controller/GanttController.ts](src/controller/GanttController.ts) (`buildSnapshot` ~:790, `sourceLinksEqual` ~:939, `RELTYPE_TO_SVAR` ~:263).
- View link seed + diff-sync: [src/bases/GanttContainer.svelte](src/bases/GanttContainer.svelte) (`planLinkSync` ~:289, `<Gantt links>` ~:1048), [src/bases/ganttSync.ts](src/bases/ganttSync.ts).
- SVAR link/tooltip capabilities: `.claude/skills/svar-svelte/gantt/index.md` (links carry `type` + optional `lag`; tooltips are task-oriented; link CSS hooks `.wx-link`/`.wx-line`).
- SVAR 2.7.0 id `:`-prefix + e2e selector learning: `docs/solutions/` SVAR upgrade notes; memory `svar-grid-resize-api-and-version-gap`.
