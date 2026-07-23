---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
type: feat
date: 2026-07-23
status: implementation-ready
origin: docs/brainstorms/2026-07-20-date-provenance-and-treatment-channels-requirements.md (section B)
---

# Inferred-Date Drag Prompt - Plan

## Goal Capsule

**Objective.** When a user resizes a Gantt bar edge whose date is **inferred** (computed from a time-estimate, not authored), ask whether to grow the **estimate only** (leave the dates unmaterialised) or **estimate and dates** (also write concrete dates), instead of writing silently. A per-view setting mirrors the existing `parentDateCascade` shape (`ask` default, with a "don't ask again" path).

**Product authority.** The Product Contract below (from a `ce-brainstorm` facilitation of section **B** of the date-provenance seed). Behaviour and scope are settled there; this plan adds the HOW.

**Open blockers.** None. The reusable substrate exists, with three deltas the mirror must respect (all codebase-verified during doc-review):

1. The drag-commit **write** lands in the deferred `persistReschedule` (which reads the after-drag position from the SVAR store), **not** the synchronous `user-gesture` intercept — the intercept only captures the pre-drag `activeDrag` snapshot.
2. Per-edge provenance comes from `RenderInstance.dateStatus` (`inferred-start` / `inferred-end` / `complete` / `swapped` / `placeholder`), **not** `applyWorkingTimeStretch`.
3. The `CascadeConfirmModal` is a boolean confirm/cancel dialog with **no** "Don't ask again" checkbox, and the parent-date-cascade mode is read-only (`getCascadeMode`) — so the checkbox is net-new and mode-persistence follows the `onThemeModeChange` / `persistThemeMode` `config.set`-callback pattern (`register.ts`), not the cascade modal.

Still reused as-is: `cascadeGate.ts`'s `normalizeCascadeMode` + `classifyUpdateGesture`, `TaskPatch.estimate` + the resolved estimate-write target, `isTimeEstimateWriteEnabled` for the writable gate, and `durationConversion` for the span↔estimate math.

## Product Contract

### Problem

The estimate drives inferred dates (a task with an authored start + a time-estimate but no due date gets a **derived end**; the reverse gives a derived start). When a user resizes such an **inferred edge**, the plugin writes silently — with no way to say whether the drag meant *"my estimate grew"* or *"stamp a real date here."* As the maintainer put it: *"sometimes I just want to stretch a date that doesn't have a due date and see the duration grow."* The two intents are indistinguishable to the plugin today.

### Actors

- **A1 — Chart editor.** A user dragging a Gantt bar's edge to adjust a task whose start or end is inferred from an estimate, who wants to decide per-drag between adjusting the estimate and committing real dates.

### Requirements

- **R1 — Prompt on an inferred-edge resize.** When a user **resizes an edge that is inferred** (the end, derived from `start + estimate` with no authored due; or the start, derived from `due − estimate` with no authored start) and the setting is `ask`, the chart shows a confirmation modal offering **Estimate only** and **Estimate and dates** before writing anything.
- **R2 — Both inferred edges.** The prompt fires for whichever dragged edge is inferred — end or start — symmetrically. Resizing an **authored** edge writes silently as today; **moving** the whole bar (shifting an authored start) does not prompt.
- **R3 — Estimate only.** Writes the recomputed **time-estimate** (from the new bar span, working-time-aware) and does **not** materialise any date — the dragged edge stays inferred. The authored edge is unchanged.
- **R4 — Estimate and dates.** Writes the recomputed estimate **and** materialises the dragged position as a concrete date (so the previously-inferred edge becomes authored).
- **R5 — Per-view setting.** A per-view mode `tngantt_inferredDrag` with values `ask` (prompt), `estimate-only` (always grow the estimate, no prompt), `estimate-and-dates` (always grow the estimate and write dates, no prompt). Default `ask`. Mirrors `parentDateCascade`'s per-view + normalize-with-default shape.
- **R6 — Don't ask again.** The modal carries a "Don't ask again" affordance; ticking it and clicking a button writes that action (`estimate-only` or `estimate-and-dates`) back to `tngantt_inferredDrag`, so subsequent inferred-edge drags apply it without prompting.
- **R7 — Cancel is a no-op.** Dismissing the modal (Escape / close) reverts the bar to its pre-drag position and writes nothing.
- **R8 — Estimate must be writable.** Both actions write the estimate, so the prompt only applies when the estimate is writable (`isTimeEstimateWriteEnabled` — `timeEstimateMode` is `tasknotes`, or `property` with a mapped property). When the estimate is not writable, an inferred-edge resize falls back to today's behaviour (write the date) with no prompt.

### Key Flows

- **F1 — Grow the estimate.** A task with an authored start + a 3h estimate + no due renders with a derived end. The user drags the end right; picks **Estimate only**; the estimate becomes (say) 5h, no due date is written, and the bar re-renders from `start + 5h`.
- **F2 — Commit real dates.** Same task; the user drags the end and picks **Estimate and dates**; the estimate updates *and* a real due date is written at the dragged position — the end is now authored.
- **F3 — Stop asking.** The user drags, ticks "Don't ask again", clicks **Estimate only**; `tngantt_inferredDrag` becomes `estimate-only`; the next inferred-edge drag grows the estimate with no modal.
- **F4 — Inferred start.** A task with an authored due + estimate + no start renders with a derived start; dragging the start edge prompts the same way and, on **Estimate only**, keeps the due fixed while growing the estimate.

### Acceptance Examples

- **AE1 — Prompt fires on inferred end.** Inferred-end task, setting `ask`, resize the end → the modal appears; nothing is written until a choice is made.
- **AE2 — Estimate only.** Choose **Estimate only** → the estimate reflects the new span; no due date is written; the bar re-renders from the new estimate. *Covers R3 / F1.*
- **AE3 — Estimate and dates.** Choose **Estimate and dates** → the estimate updates and a concrete due date is written at the dragged edge. *Covers R4 / F2.*
- **AE4 — Don't ask again.** Tick "Don't ask again" + **Estimate only** → `tngantt_inferredDrag` is now `estimate-only`; a second inferred-edge drag applies estimate-only with no modal. *Covers R6 / F3.*
- **AE5 — Inferred start.** Inferred-start task, resize the start → prompt fires; **Estimate only** keeps the due fixed and grows the estimate. *Covers R2 / F4.*
- **AE6 — Authored edge unaffected.** Resize an edge that has a real authored date → writes silently, no prompt. *Covers R2.*
- **AE7 — Cancel reverts.** Open the modal, dismiss it → the bar returns to its pre-drag position, nothing written. *Covers R7.*
- **AE8 — Estimate not writable.** With the estimate not writable (`timeEstimateMode: dont-update`), resize an inferred end → no prompt; the date is written as today. *Covers R8.*

### Scope Boundaries (out)

- **Provenance rendering (seed A)** — how an inferred vs authored edge is *visually cued* on the bar. This feature reads provenance to decide when to prompt but does not change how it's displayed.
- **Retiring "incomplete" as a user-facing concept (seed C).**
- **Move-the-bar prompting** — dragging the whole bar shifts the authored start; only edge *resizes* of inferred edges prompt.
- **A dates-only action** (materialise without touching the estimate) — both offered actions update the estimate.

### Open Questions (→ resolved in planning / deferred to implementation)

- **OQ1 — Which dates "Estimate and dates" writes.** *Resolved:* materialise **the dragged (inferred) edge only**; an already-authored counterpart is left untouched (KTD2).
- **OQ2 — Estimate rounding / granularity, and working-time awareness.** *Deferred to implementation:* reuse `durationConversion` (`spanDaysToMinutes(inclusiveDaySpan(...))`); confirm rounding so a one-day drag maps to a predictable estimate delta (the same conversion a resize uses today). Also confirm whether the recompute is flat day-granular (what `spanDaysToMinutes` yields) or working-time-aware (R3's wording) — the two diverge across weekends/holidays. Default to the flat conversion unless the resize path's working-time stretch is deliberately applied; align R3's phrasing with whichever is chosen.
- **OQ3 — Estimate-not-writable fallback.** *Resolved:* silent date-write, no prompt, gated on `isTimeEstimateWriteEnabled` (R8 / KTD3). There is no `timeEstimateMode: off` value — the disabled state is `dont-update`, or `property` with no mapped property.
- **OQ4 — Modal wording.** *Resolved:* button labels are fixed (**Estimate only** / **Estimate and dates**); the body copy must name each action's consequence (U3) rather than being left as a nicety, since the labels alone don't convey that "Estimate only" leaves the edge inferred.
- **OQ5 — Placeholder (both-derived) tasks.** *Deferred to implementation:* a `placeholder` task (neither date authored) carrying an estimate renders with both edges derived. Decide whether an edge resize on it prompts and, for **Estimate and dates**, which anchor holds fixed (there is no authored counterpart). Simplest default: treat `placeholder` as non-inferred (no prompt, write-as-today) unless a clear anchor exists.
- **OQ6 — Coexistence with the parent-date cascade prompt.** *Deferred to implementation:* a user-gesture on an inferred-edge task that is also a parent can trigger both the new inferred-drag prompt and the existing shrink-fit / ancestor-extend `CascadeConfirmModal`. Define ordering — the inferred-drag decision determines the write; the cascade prompt then reconciles ancestors/children against the committed dates — so a coherent sequence fires, not two conflicting writes.

---

## Product Contract preservation

Product Contract behaviour **unchanged**. Doc-review applied codebase-accuracy corrections that do not change product scope: R8 / AE8 restate the writable-estimate gate as `isTimeEstimateWriteEnabled` (there is no `timeEstimateMode: off` value); R6 dropped an incorrect "matches the `CascadeConfirmModal` path" implementation claim (the behaviour it describes is unchanged). OQ1 / OQ3 resolved into KTD2 / KTD3. No R/A/F/AE behaviour changed.

## Key Technical Decisions

- **KTD1 — Reuse the cascade pattern where it fits; extend the modal where it doesn't.** `normalizeInferredDragMode` mirrors `normalizeCascadeMode` (default `ask`); the setting is a per-view dropdown like `tngantt_parentDateCascade`, read via a `normalize`-with-default getter. The modal reuses `CascadeConfirmModal`'s **structure** (hosted via `app`; title/body/buttons; Escape/backdrop → cancel; promise resolution) but must **add** a "Don't ask again" checkbox and resolve a richer `{ action, dontAskAgain }` (the existing modal has neither — it resolves a bare `boolean`). Mode write-back is net-new: it follows the `onThemeModeChange` / `persistThemeMode(config.set, …)` callback pattern in `register.ts` (the cascade mode is read-only via `getCascadeMode`, so there is no cascade persistence to mirror). Advances R1, R5, R6.
- **KTD2 — The action gates which `TaskPatch` fields are written.** `TaskPatch` already carries `estimate` and dates, and `GanttController.mutate` already resolves the estimate write target. **Estimate only** builds a patch with the recomputed `estimate` and **omits the dragged (inferred) date field** (keeping it unmaterialised); **estimate-and-dates** writes the estimate **and** the dragged edge's date. The write path itself is reused (`onMutate` → `mutate`); the change is that `persistReschedule`'s current *unconditional* `{ start, end, estimate }` co-write becomes the per-action patch for an inferred edge (authored-edge and whole-bar-move paths keep the co-write). Advances R3, R4; resolves OQ1.
- **KTD3 — The prompt requires a writable estimate.** Both actions write the estimate, so the gate only engages when the estimate is writable — the container already exposes this as `timeEstimateWriteEnabled` (from `isTimeEstimateWriteEnabled`, which is false in `dont-update` mode **and** in `property` mode with no mapped property). When it is not writable, an inferred-edge resize falls back to today's date-write with no prompt. Advances R8; resolves OQ3.
- **KTD4 — Inferred-edge detection is a pure classifier over `dateStatus`.** A dragged edge is inferred when its rendered date was *derived* rather than authored — the signal is `RenderInstance.dateStatus` (computed by `datePolicy.ts`, carried on instances via `InstanceExpansion.ts`): `inferred-end` → the end is derived (authored start); `inferred-start` → the start is derived (authored due); `complete` / `swapped` → both authored (→ `null`, no prompt); `placeholder` → both derived (see Open Questions OQ5). The gate takes the drag (which edge moved) + the instance's `dateStatus` and returns which edge, if any, is inferred. Advances R1, R2.
- **KTD5 — Pure decision + conversion, thin modal + wiring.** The mode resolution, inferred-edge classification, span→estimate conversion, and patch-field decision live in a pure, Jest-tested module (`inferredDragGate.ts`), mirroring `cascadeGate.ts`. The modal and the `GanttContainer` drag-commit wiring are thin and proven by the e2e. Advances the Verification Contract.

## High-Level Technical Design

The drag-commit decision, inside `persistReschedule` in `GanttContainer` (where the after-drag position is available) through to the write:

```mermaid
flowchart TD
  A[Drag commit in persistReschedule<br/>after-drag position from SVAR store] --> B{Resize of an edge?<br/>(not a whole-bar move)}
  B -- whole-bar move --> Z[Write as today<br/>onMutate: dates + estimate]
  B -- resize --> C{Is the dragged edge inferred?<br/>KTD4 classifier}
  C -- authored --> Z
  C -- inferred --> D{Estimate writable?<br/>timeEstimateWriteEnabled}
  D -- not writable --> Z
  D -- writable --> E{tngantt_inferredDrag}
  E -- estimate-only --> F[Patch: estimate, NO date]
  E -- estimate-and-dates --> G[Patch: estimate + dragged date]
  E -- ask --> H[CascadeConfirmModal-style prompt]
  H -- Estimate only --> F
  H -- Estimate and dates --> G
  H -- Cancel --> X[Revert bar, write nothing]
  H -. Don't ask again .-> W[Persist chosen action to<br/>tngantt_inferredDrag]
  F --> Y[onMutate applies patch]
  G --> Y
```

The one new decision surface is the middle band (is-inferred? → writable? → mode → action → patch fields); everything else reuses existing paths — `onMutate`/`mutate`, the estimate write target, and the cascade modal + don't-ask-again persistence.

---

## Implementation Units

### U1. Pure inferred-drag gate (mode, classification, patch decision)

- **Goal.** A dependency-free module that resolves the mode, classifies which dragged edge is inferred, converts the new span to an estimate, and decides which `TaskPatch` fields each action writes.
- **Requirements.** R1, R2, R3, R4, R8; KTD1, KTD2, KTD3, KTD4.
- **Dependencies.** None (pure; wired in U4).
- **Files.** `src/bases/inferredDragGate.ts`, `test/unit/inferredDragGate.test.ts`.
- **Approach.** `normalizeInferredDragMode(value)` → `'ask' | 'estimate-only' | 'estimate-and-dates'` (default `ask`), mirroring `normalizeCascadeMode`. A classifier that, given the drag (before/after start+end, which edge moved) and the instance's `dateStatus`, returns the inferred dragged edge or `null` (`inferred-end` → end, `inferred-start` → start; authored edge / `complete` / `swapped` / whole-bar move → `null`). A resolver that, given `(inferredEdge, mode, estimateWritable)`, returns the outcome: `prompt`, `estimate-only`, `estimate-and-dates`, or `write-as-today` (when not inferred or estimate not writable). A patch-field helper that, given the outcome + the new span, returns `{ estimateMinutes, materialiseEdge? }` — estimate-only omits the date, estimate-and-dates includes the dragged edge's date. Span→estimate via `durationConversion`.
- **Execution note.** Implement test-first — this pure module is the whole decision surface; the modal and wiring just enact its output.
- **Patterns to follow.** `src/bases/cascadeGate.ts` (pure gate module, `normalizeCascadeMode`, the classify* functions); `src/controller/durationConversion.ts` for span↔minutes; `src/controller/datePolicy.ts` / `src/bases/types/gantt-view-data.ts` for the `DateStatus` values the classifier reads.
- **Test scenarios.**
  - `normalizeInferredDragMode`: `ask`/`estimate-only`/`estimate-and-dates` pass through; unknown/absent → `ask`.
  - Classifier: resize of the derived END (authored start, no due) → inferred edge = end. *Covers AE1.*
  - Classifier: resize of the derived START (authored due, no start) → inferred edge = start. *Covers AE5.*
  - Classifier: resize of an AUTHORED edge → `null` (no prompt). *Covers AE6.*
  - Classifier: whole-bar move (both edges shift equally) → `null`.
  - Resolver: inferred edge + `ask` + writable → `prompt`; + `estimate-only` → estimate-only; + `estimate-and-dates` → estimate-and-dates.
  - Resolver: inferred edge + estimate NOT writable → `write-as-today` regardless of mode. *Covers AE8 / R8.*
  - Patch helper: estimate-only → carries `estimateMinutes`, no materialised date. *Covers AE2.*
  - Patch helper: estimate-and-dates → carries `estimateMinutes` AND the dragged edge's date; leaves the authored counterpart out. *Covers AE3 / OQ1.*
  - Span→estimate: a one-day-longer drag maps to the expected minutes via `spanDaysToMinutes`/`inclusiveDaySpan`.

### U2. Setting, reader, getter

- **Goal.** Expose `tngantt_inferredDrag` as a per-view dropdown, readable and threaded to the view.
- **Requirements.** R5, R6.
- **Dependencies.** U1 (reuses `normalizeInferredDragMode`).
- **Files.** `src/bases/viewOptions.ts`, `test/unit/viewOptions.test.ts`, `src/bases/register.ts`.
- **Approach.** Add a dropdown option `tngantt_inferredDrag` (`ask` / `estimate-only` / `estimate-and-dates`, default `ask`) in the appearance/behaviour section, near `tngantt_parentDateCascade`. Add a reader that coerces via `normalizeInferredDragMode`. Add a `register.ts` getter (mirror `getCascadeMode`) and thread the value to `GanttContainer` (prop) alongside the existing cascade mode. **Also allocate the write-back callback here:** an `onInferredDragModeChange` prop wired in `register.ts` to `this.config.set('tngantt_inferredDrag', action)`, mirroring `onThemeModeChange` → `persistThemeMode` — R6's "don't ask again" persists through this callback.
- **Patterns to follow.** The `tngantt_parentDateCascade` dropdown declaration + its `getCascadeMode` getter; `readTimeEstimateMode` for the reader shape; `onThemeModeChange` / `persistThemeMode` (`register.ts`) for the mode write-back callback.
- **Test scenarios.**
  - Reader: `estimate-only`/`estimate-and-dates`/`ask` recognised; unknown → `ask`; absent → `ask`.
  - `appearanceOptions()` (or the relevant section) includes `tngantt_inferredDrag` with the three labelled options and default `ask`.

### U3. Confirmation modal

- **Goal.** A modal offering **Estimate only** and **Estimate and dates** with a "Don't ask again" affordance, returning the chosen action + whether to persist it.
- **Requirements.** R1, R6, R7.
- **Dependencies.** None (constructed by U4; presentation only).
- **Files.** `src/bases/InferredDragModal.ts` (new; mirrors `src/bases/CascadeConfirmModal.ts`).
- **Approach.** Mirror `CascadeConfirmModal`'s **structure** (host via `app`, a title, a one-line body, a `new Setting(contentEl)` button row, Escape/backdrop → cancel via `onClose`, promise resolution), noting two deltas from that modal: (1) it resolves a richer `{ action: 'estimate-only' | 'estimate-and-dates', dontAskAgain: boolean }` (or a cancellation), not a bare `boolean`; (2) it adds a **net-new** "Don't ask again" control (`Setting.addToggle`, unchecked by default, in its own row above the buttons and before them in tab order). **Focus/Enter safety:** make **Estimate only** the sole `setCta()` primary and default-focus it (it is the conservative action — grows the estimate, materialises no date), so Enter picks it and Escape cancels; **Estimate and dates** is a non-CTA secondary. Do **not** mark both buttons CTA — this modal has no Cancel button to default-focus, unlike `CascadeConfirmModal`. Body copy names each action's consequence, e.g. *"This edge's date is inferred from the estimate — grow just the estimate (the date stays computed), or grow the estimate and pin a real date here?"*
- **Execution note.** The decision logic is U1; this unit is presentation plus the focus/checkbox wiring above. Its behaviour is proven end-to-end in U5 (drag → prompt → Escape-cancel and each action) rather than by a unit test.
- **Patterns to follow.** `src/bases/CascadeConfirmModal.ts` (modal structure, `new Setting` button wiring, `onClose` → cancel, promise resolution); `Setting.addToggle` for the net-new checkbox.
- **Test scenarios.** `Test expectation: none -- thin presentation modal; the branching decision it enacts is unit-tested in U1 and the full open→choose→write flow is covered by U5's e2e.`

### U4. Wire into the drag-commit path

- **Goal.** At a drag-commit, route an inferred-edge resize through the gate: prompt (or auto-apply), then write the action's patch; persist the mode on "don't ask again".
- **Requirements.** R1–R8; KTD1, KTD2, KTD3.
- **Dependencies.** U1, U2, U3.
- **Files.** `src/bases/GanttContainer.svelte`, `src/bases/register.ts`, `test/unit/ganttSync.test.ts` (or a focused test for any newly-extracted pure helper).
- **Approach.** The gate runs **inside `persistReschedule`** (`GanttContainer.svelte`) — the deferred write where both the pre-drag `activeDrag` snapshot **and** the after-drag position (`api.getState().tasks.byId`) are available; the synchronous `user-gesture` intercept has only the pre-drag state, so it cannot see which edge moved. Map the before/after `{ start, end }` to the moved edge (start-only changed / end-only changed / both → whole-bar move), combine with the instance's `dateStatus` (captured into `activeDrag` at drag-start, or read from the instance at commit) and the view's `inferredDrag` mode + `timeEstimateWriteEnabled` via U1's classifier + resolver. On `write-as-today`, keep `persistReschedule`'s existing `{ start, end, estimate }` co-write. On `prompt`, open the U3 modal (via `app`); on cancel, revert the bar and write nothing (R7); on a choice, **replace the co-write** with the per-action `TaskPatch` from U1's patch helper and call `onMutate` (estimate via `TaskPatch.estimate`; materialised date only for estimate-and-dates). On "don't ask again", persist the chosen action to `tngantt_inferredDrag` through U2's `onInferredDragModeChange` callback. Keep the authored-edge and whole-bar-move paths untouched (R2).
- **Execution note.** Extract the pure glue and unit-test it: the payload→edge mapping (before/after `{ start, end }` → moved edge) and the `dateStatus` → inferred-edge combination both belong in U1's module or a sibling pure helper; the `persistReschedule` restructuring itself is proven by U5.
- **Patterns to follow.** `persistReschedule` in `GanttContainer.svelte` (the deferred drag-commit write, `activeDrag` capture, `api.getState().tasks.byId`); the existing `onMutate` → `controller.mutate` resize path; `onThemeModeChange` for the mode write-back callback.
- **Test scenarios.**
  - A newly-extracted payload-mapping helper (if any): a SVAR resize payload → correct before/after edges handed to the classifier.
  - *Integration coverage for the full drag→prompt→write flow is U5 (real Obsidian); the pure decisions are U1.*

### U5. End-to-end: drag → prompt → write

- **Goal.** Prove the whole flow in real Obsidian: inferred-edge drag prompts; each action writes the right thing; the setting and fallbacks hold.
- **Requirements.** R1–R8; AE1–AE8.
- **Dependencies.** U1–U4.
- **Files.** `test/specs/gantt-inferred-date-drag.e2e.ts`, test-vault fixtures under `test/vaults/` (a task with an authored start + estimate + no due for the inferred-end case; one with authored due + estimate + no start for the inferred-start case; a view with the estimate **not** writable — `tngantt_timeEstimateMode: dont-update`, or `property` with no mapped estimate property — for the AE8 fallback).
- **Approach.** Drive a real Gantt: resize an inferred end → assert the modal appears (AE1); **Estimate only** → the note's estimate changed, no due written (AE2); **Estimate and dates** → estimate changed AND a due date written (AE3); tick "Don't ask again" + Estimate only → the view's `tngantt_inferredDrag` is now `estimate-only` and a second drag writes with no modal (AE4); inferred-start resize prompts and Estimate only keeps the due (AE5); resize an authored edge → no modal (AE6); open then press **Escape** → bar reverts, nothing written (AE7 — drive cancel via an explicit Escape keypress, since this modal has no Cancel button); with the estimate not writable (`timeEstimateMode: dont-update`), resize an inferred end → no modal, date written (AE8).
- **Execution note.** Run with `npm run e2e:local` against real Obsidian; do not defer. Drag-commit + modal + file-write is exactly the kind of multi-layer flow unit tests can't prove.
- **Patterns to follow.** Existing drag/resize e2e specs (e.g. `test/specs/gantt-calendar-stretch.e2e.ts`, `gantt-inline-edit.e2e.ts`) for driving a resize and reading the resulting note frontmatter.
- **Test scenarios.** *Covers AE1–AE8* as enumerated above (happy paths for both actions and both edges, the don't-ask-again persistence, the cancel/revert path, the authored-edge no-op, and the estimate-not-writable fallback).

---

## Verification Contract

- **Unit.** `npm test` green, including `inferredDragGate` (mode/classify/resolve/patch/conversion), the `viewOptions` reader case, and any extracted payload-mapping helper.
- **Types + lint.** `svelte-check` / eslint clean (strict, no `any`).
- **E2E.** `npm run e2e:local` green, including the new `gantt-inferred-date-drag` scenarios (AE1–AE8), with the existing drag/resize specs still passing (no regression to authored-edge or whole-bar-move behaviour).

## Definition of Done

- U1–U5 landed; R1–R8 satisfied; AE1–AE8 covered by tests.
- An inferred-edge resize prompts (mode `ask`) or applies the configured action; estimate-only leaves dates unmaterialised, estimate-and-dates materialises the dragged edge; both update the estimate.
- "Don't ask again" persists the chosen action to `tngantt_inferredDrag`; cancel reverts; authored edges and whole-bar moves are unchanged (R2, R7).
- A non-writable estimate (`timeEstimateMode: dont-update`, or `property` with no mapped property) falls back to today's date-write with no prompt (R8).
- Typecheck, lint, unit, and e2e all green.
- PR opened targeting `main`, behind green CI, for maintainer review.

## Sources & Research

- Origin: `docs/brainstorms/2026-07-20-date-provenance-and-treatment-channels-requirements.md` (section B) and the Product Contract above.
- Grounding read this session: `src/bases/cascadeGate.ts` (`normalizeCascadeMode`, `classifyUpdateGesture`, the pure-gate pattern), `src/bases/CascadeConfirmModal.ts` (the modal to mirror), `src/bases/GanttContainer.svelte` (the `user-gesture` drag-commit branch, `onMutate`, the `app`-hosted cascade modal), `src/datasource/types.ts` (`TaskPatch.estimate`), `src/controller/GanttController.ts` (`mutate` estimate write target, `estimateWritable`, `applyWorkingTimeStretch`), `src/controller/durationConversion.ts` (`spanDaysToMinutes`, `inclusiveDaySpan`), `src/bases/viewOptions.ts` (`timeEstimateMode`, `isTimeEstimateWriteEnabled`, the `parentDateCascade` dropdown), `src/controller/datePolicy.ts` + `src/controller/InstanceExpansion.ts` + `src/bases/types/gantt-view-data.ts` (`RenderInstance.dateStatus` — the inferred-edge signal), `src/bases/register.ts` (`getCascadeMode`, and the `onThemeModeChange` / `persistThemeMode` write-back pattern), and `GanttContainer.svelte`'s `persistReschedule` (the deferred drag-commit write). No external research — the pattern is fully local (the parent-date-cascade feature is the in-repo precedent). Doc-review (2026-07-23) corrected three codebase-verified inaccuracies before execution: the `CascadeConfirmModal` has no don't-ask-again checkbox and the cascade mode is not persisted (so the checkbox + write-back are net-new); the provenance signal is `dateStatus`, not `applyWorkingTimeStretch`; and there is no `timeEstimateMode: off` value (gate on `isTimeEstimateWriteEnabled`).
