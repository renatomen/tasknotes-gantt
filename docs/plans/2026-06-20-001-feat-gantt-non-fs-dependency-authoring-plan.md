---
date: 2026-06-20
plan_id: 001
type: feat
title: "feat: Gantt non-FS dependency authoring — reltype-aware TaskNotes + FF/SS/SF create + reltype/gap edit"
origin: docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md
status: active
milestone: "M3 Non-FS authoring"
tracking_issues: [86, 87]
upstream_issue: 91
---

# feat: Gantt non-FS dependency authoring (M3)

Milestone 3 of the RFC 9253 dependency epic (origin: [docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md](docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md); GitHub epic #91, issues #86/#87). The distinctive value: visually authoring **non-Finish-to-Start** dependencies — nowhere else in the TaskNotes ecosystem can a user set FF/SS/SF + lag/lead.

**Cross-repo.** This plan spans two repos. Units tagged **[tasknotes]** land in the sibling fork `renatomen/tasknotes` (local clone at the machine path recorded in the origin doc's Dependencies section); units tagged **[obsidian-gantt]** land in this repo. Per-unit `**Target repo:**` labels disambiguate, and all file paths are repo-relative to their unit's target repo.

---

## Summary

Two capabilities, gated behind one upstream change:

1. **UT (R12) — make TaskNotes reltype-aware [tasknotes].** Today TaskNotes treats *every* `blockedBy` edge as a hard Finish-to-Start block (`DependencyCache` discards reltype at indexing time). Teach its blocked-state computation to honor reltype: `FINISHTOSTART` always gates "blocked"; `FINISHTOFINISH` gates until the predecessor completes; `STARTTOSTART`/`STARTTOFINISH` never gate. Behavior is unchanged for existing FS-only vaults.
2. **Non-FS authoring + editing [obsidian-gantt].** Once TaskNotes honors reltype, let the user **create** FF/SS/SF dependencies via SVAR's start/end handle geometry (#86, R8) and **edit** an existing link's reltype + gap from a link context menu (#87, R9).

The obsidian-gantt write path is almost entirely reuse: M2 already shipped `addDependency(dependentPath, predecessorPath, reltype, ctx)` (the reltype parameter is already there), the SVAR `add-link` intercept, instance→source resolution, and echo-suppression. M3's create side is a small relaxation of one guard. The edit side adds an `updateDependency` upsert + a link context menu.

**Delivery (decided):** *fork build, upstream later.* The reltype-aware change is built and run from the local `tasknotes` fork; the e2e harness and dev vault point at that local build for M3 verification. A PR to `callumalpass/tasknotes` is tracked separately and is **out of this plan's scope**.

---

## Problem Frame

M1 made all four reltypes render (PR #92); M2 made FS links create/delete-able (PR #97). What remains is the non-FS half — blocked since the start on a single upstream constraint.

### The reltype-blindness constraint (load-bearing)

`blockedBy` stores `{uid, reltype, gap?}` per edge, and the data round-trips losslessly (M1 reads all four). But TaskNotes **acts only on an edge's existence, never its reltype**, and the blindness starts deeper than `isBlocked`:

- [`DependencyCache.indexTaskFile`](src/utils/DependencyCache.ts) (tasknotes) calls `normalizeDependencyList` — which *does* carry reltype — but then keeps **only `resolved.path`** in `dependencySources`/`dependencyTargets` (`Set<string>`). The reltype is dropped before any blocked-state logic can see it.
- [`DependencyCache.isTaskBlocked`](src/utils/DependencyCache.ts) therefore returns "blocked" whenever a task has any incomplete blocking path — reltype is structurally unavailable.
- Consumers inherit the blindness: `TaskManager.isTaskBlocked`/`getBlocked*` ([src/utils/TaskManager.ts](src/utils/TaskManager.ts)), Bases blocked properties ([src/bases/helpers.ts](src/bases/helpers.ts)), and the auto-unblock side-effect ([src/services/task-service/taskPropertyChangeSideEffects.ts](src/services/task-service/taskPropertyChangeSideEffects.ts)) all treat every edge as FS.

Consequence: if the Gantt writes an `STARTTOSTART` edge today, TaskNotes still marks the dependent "blocked" everywhere — semantically wrong, and confusing in the half of the workflow that lives in TaskNotes. The fix belongs upstream, in the cache's data model and blocked-state logic — not papered over in the Gantt (origin "Outside this product's identity").

### On the Gantt side

- `classifyLinkCreate` ([src/bases/cascadeGate.ts:150](src/bases/cascadeGate.ts#L150)) hard-rejects every geometry except `e2s` (`if (link.type !== 'e2s') return null`). It returns `{predecessor, dependent}` with no reltype.
- The `add-link` intercept in [src/bases/GanttContainer.svelte](src/bases/GanttContainer.svelte) shows a "Only Finish-to-Start links can be created for now" Notice on non-FS drags and hardcodes the FS call.
- There is no edit path: no way to change an existing edge's reltype or set/clear its gap. The source layer has `add`/`removeDependency` but no `updateDependency`.

---

## Requirements

Traced from the origin doc:

- **R8** — Once TaskNotes is reltype-aware, the user can create `FINISHTOFINISH`/`STARTTOSTART`/`STARTTOFINISH` dependencies via SVAR's start/end handle semantics (which handles the drag connects determine the type).
- **R9** — The user can edit an existing link's reltype and gap from the Gantt.
- **R12 (UT)** — TaskNotes' blocked-state computation (`isBlocked`, blocked/unblocked views, `dependencies.isBlocked`/`isBlocking` filter properties, auto-unblock-on-complete) honors `reltype`: `FINISHTOSTART` always contributes to "blocked"; `FINISHTOFINISH` contributes until the predecessor completes; `STARTTOSTART`/`STARTTOFINISH` do not gate the blocked state. Behavior unchanged for existing FS-only vaults.

Origin acceptance examples in scope: **AE7** (a `STARTTOSTART` edge from an incomplete predecessor does not falsely mark the dependent blocked — post-R12). The create/edit round-trips extend AE3/AE4 (M2) to non-FS reltypes and gap.

---

## Key Technical Decisions

- **KTD1 — UT preserves reltype in the dependency index, then makes `isTaskBlocked` reltype-aware; consumers inherit. [tasknotes]** The load-bearing change is the data model: `DependencyCache` must keep each edge's reltype alongside its resolved path (e.g. `dependencySources: Map<path, Map<blockingPath, reltype>>`, or a `{path, reltype}` record set). `isTaskBlocked` then applies the reltype rule. `TaskManager`, Bases helpers, filters, and the auto-unblock side-effect call through `isTaskBlocked`/`getBlocked*`, so they inherit correct behavior without per-consumer edits. The reverse index (`dependencyTargets`, "what does this block") must also carry reltype so blocked-path queries can filter to gating edges.

- **KTD2 — The reltype gating rule (per R12, verbatim).** A blocking edge contributes to "blocked" iff: reltype is `FINISHTOSTART` (always, while predecessor incomplete), OR reltype is `FINISHTOFINISH` (while predecessor incomplete). `STARTTOSTART` and `STARTTOFINISH` never contribute. A **completed** predecessor never gates, for any reltype (preserves the existing status-aware behavior in `isTaskBlocked` and TaskNotes issue-1878 semantics). A task is blocked iff it has ≥1 gating edge to an incomplete predecessor.

- **KTD3 — Non-FS create reuses the M2 write path; only the classifier + one guard change. [obsidian-gantt]** `addDependency` already accepts a `reltype` (M2 just always passed `FINISHTOSTART`). M3 adds an SVAR-type→reltype map — the inverse of the existing `RELTYPE_TO_SVAR` ([src/controller/GanttController.ts:263](src/controller/GanttController.ts#L263)) — and extends `classifyLinkCreate` to return `{predecessor, dependent, reltype}` for all four geometries (`e2s`→FS, `s2s`→SS, `e2e`→FF, `s2e`→SF). Direction still comes from handle geometry, not drag order, so a reversed drag yields a different (correct) reltype, never an inverted edge. The `add-link` intercept drops the "FS only" Notice and passes the classified reltype to `controller.addDependency`.

- **KTD4 — Edit is an in-place upsert (`updateDependency`), not remove+add. [obsidian-gantt]** Changing an edge's reltype/gap reads the raw `blockedBy`, finds the entry whose `uid` resolves to the predecessor, and rewrites that entry's `reltype`/`gap` while preserving its `uid` and array position. This avoids a transient "edge removed then re-added" flicker and keeps edge identity stable. Mirrors `add`/`removeDependency`'s read-modify-write. Clearing a gap omits the `gap` key (TaskNotes' `serializeDependencies` only writes `gap` when non-empty).

- **KTD5 — Edit UI is a link context menu (Obsidian `Menu`), not a SVAR editor. [obsidian-gantt]** Right-clicking a rendered arrow (`svg.wx-links g.wx-line[data-link-id]`) opens a native Obsidian menu: a reltype submenu (four items, the current one checked) and "Set gap…/Clear gap". This mirrors the existing bar context-menu pattern (`onBarContextMenu` → TaskNotes task menu) and the contextmenu handler already in `GanttContainer` (extended to also match `data-link-id`). No integration of SVAR's built-in editor sidebar (heavyweight, styling-divergent). Gap is entered via a small input modal (days → `P{n}D`).

- **KTD6 — `gap` is a verbatim ISO-8601 duration string. [both]** TaskNotes stores `gap` as-is (`serializeDependencies` writes the string unchanged; `normalizeDependencyEntry` trims and keeps it). The edit UI authors a positive day count as `P{n}D`. **Lead (negative gap) handling is deferred to implementation** — confirm whether TaskNotes/RFC 9253 represents lead as a signed duration before exposing it; M3 ships lag (≥0) and clear, with lead flagged as a follow-up if the round-trip is non-trivial.

- **KTD7 — Fork build, upstream later. [test infra]** The reltype-aware TaskNotes is built from the local fork and consumed locally. The e2e harness's pinned `{repo: "callumalpass/tasknotes", version: "4.11.0"}` entry ([test/wdio/wdio.conf.mts](test/wdio/wdio.conf.mts)) is swapped — behind an env gate — for a local `{path: "<local tasknotes build>"}` entry for the M3 specs (the wdio.conf already documents this `{path}` escape hatch). A `callumalpass/tasknotes` PR is **not** in scope; CI coverage of UT-dependent behavior is a known gap until a fork release (see Risks).

---

## High-Level Technical Design

### Cross-repo flow (create a non-FS link, post-UT)

```mermaid
sequenceDiagram
  participant U as User
  participant G as SVAR Gantt
  participant C as GanttContainer (add-link intercept)
  participant Ctrl as GanttController
  participant S as TaskNotesSource
  participant TN as TaskNotes (reltype-aware, UT)
  U->>G: drag A's START handle → B's START handle
  G->>C: add-link {source:A, target:B, type:"s2s"}
  C->>C: classifyLinkCreate → {predecessor:A, dependent:B, reltype:STARTTOSTART}
  C->>Ctrl: addDependency(A, B, STARTTOSTART)
  Ctrl->>S: addDependency(Bpath, Apath, STARTTOSTART, ctx)
  S->>TN: tasks.update(B, { blockedBy:[...,{uid:[[A]],reltype:STARTTOSTART}] })
  TN->>TN: DependencyCache indexes edge WITH reltype; isTaskBlocked: SS does NOT gate
  TN-->>Ctrl: change event (echo-suppressed) → arrow drawn on every instance of B
  Note over TN: B is NOT marked "blocked" (SS) — the harmonization payoff
```

### The reltype gating rule (KTD2)

| reltype | predecessor incomplete | predecessor complete |
|---|---|---|
| `FINISHTOSTART` | **gates (blocked)** | does not gate |
| `FINISHTOFINISH` | **gates (blocked)** | does not gate |
| `STARTTOSTART` | does not gate | does not gate |
| `STARTTOFINISH` | does not gate | does not gate |

"Blocked" = the task has ≥1 gating edge. FS-only vaults: every edge is FS → identical to today (regression-safe).

---

## Implementation Units

Sequencing: **U1 → U2** (UT, tasknotes) → **U3** (local-build test wiring) → **U4** (#86 create) → **U5 → U6** (#87 edit). U4–U6 are unit-testable independently but are verified end-to-end against the U1/U2 build via U3, and must not be enabled for users before UT lands (they ship together from the fork build).

### U1. Preserve reltype in the dependency index

- **Target repo:** tasknotes
- **Goal:** Carry each `blockedBy` edge's reltype through `DependencyCache`'s forward and reverse indexes so blocked-state logic can consult it.
- **Requirements:** R12 (enabling data model).
- **Dependencies:** none.
- **Files:**
  - `src/utils/DependencyCache.ts` — change `dependencySources`/`dependencyTargets` from `Map<string, Set<string>>` to a reltype-carrying structure (e.g. `Map<string, Map<string, TaskDependencyRelType>>`). Update `indexTaskFile` (keep `dep.reltype` from the already-normalized entry, not just `resolved.path`), `clearForwardDependencies`, `clearFileFromIndexes`, `getFileRelationshipSignature` (signature must include reltype so a reltype-only change still fires `EVENT_DEPENDENCY_CACHE_CHANGED`), and the `getBlocking*/getBlocked*` accessors' internal reads.
  - Tests: `tests/unit/utils/DependencyCache.test.ts` (mirror the repo's existing cache test location/naming).
- **Approach:** `normalizeDependencyList(dependencies)` already yields `TaskDependency[]` with `reltype`; thread that reltype into the index instead of discarding it at the `resolved.path` step. Keep public accessor return types path-based where callers only need paths (add reltype-aware variants rather than breaking signatures).
- **Patterns to follow:** the existing index maintenance in `indexTaskFile`/`clearForwardDependencies`/`clearFileFromIndexes`; `normalizeDependencyEntry`/`normalizeDependencyList` in `src/utils/dependencyUtils.ts`.
- **Test scenarios:**
  - Indexing a task whose `blockedBy` has mixed reltypes preserves each edge's reltype in both forward and reverse indexes.
  - `getFileRelationshipSignature` differs when only an edge's reltype changes (FS→SS), so the change event fires.
  - Re-index after edit replaces the reltype (no stale FS left behind).
  - Rename/delete still clears edges (reltype-carrying structure cleaned up symmetrically).
- **Verification:** tasknotes unit suite green; the cache exposes reltype per edge; existing path-based accessors unchanged for callers that don't need reltype.

### U2. Make blocked-state reltype-aware

- **Target repo:** tasknotes
- **Goal:** Apply the KTD2 gating rule in `isTaskBlocked` and the blocked-path queries so views, filters, badges, and auto-unblock honor reltype.
- **Requirements:** R12; AE7.
- **Dependencies:** U1.
- **Files:**
  - `src/utils/DependencyCache.ts` — `isTaskBlocked`: a task is blocked iff it has ≥1 **gating** edge (per KTD2 table) to an incomplete predecessor. `getBlockedTaskPaths` (tasks blocked BY this one, used by auto-unblock-on-complete): return only dependents reached by a gating edge.
  - `src/utils/TaskManager.ts` — verify the pass-throughs (`isTaskBlocked`, `getBlocking/BlockedTaskPaths`) need no change beyond inheriting cache behavior; adjust only if a caller relied on reltype-blind semantics.
  - `src/bases/helpers.ts`, `src/services/task-service/taskPropertyChangeSideEffects.ts` — audit: confirm they consume `isTaskBlocked`/`getBlockedTaskPaths` and thus inherit correctness; no logic change expected.
  - Tests: `tests/unit/utils/DependencyCache.test.ts` (extend), and any existing blocked-views/filter test.
- **Approach:** Centralize the gating predicate as a small helper (`reltypeGatesBlocked(reltype, predecessorCompleted)`) and use it in both `isTaskBlocked` and `getBlockedTaskPaths`. Completed-predecessor short-circuit stays.
- **Patterns to follow:** the existing status-aware loop in `isTaskBlocked` (it already skips completed predecessors).
- **Test scenarios:**
  - **Covers AE7.** A task with only a `STARTTOSTART` edge to an *incomplete* predecessor is **not** blocked.
  - `STARTTOFINISH` edge to an incomplete predecessor → not blocked.
  - `FINISHTOSTART` edge to incomplete predecessor → blocked (unchanged).
  - `FINISHTOFINISH` edge to incomplete predecessor → blocked; to a completed predecessor → not blocked.
  - Mixed edges: one FS (incomplete) + one SS → blocked (the FS gates).
  - FS-only vault regression: identical results to pre-change for a battery of FS fixtures.
  - `getBlockedTaskPaths` returns only gating-edge dependents (an SS-only dependent is excluded), so auto-unblock-on-complete doesn't falsely notify it.
- **Verification:** tasknotes unit suite green; manual: a vault with an SS edge shows the dependent as **not** blocked in TaskNotes' blocked view/badge; FS vaults behave exactly as before.

### U3. Wire the e2e harness + dev vault to the local reltype-aware TaskNotes build

- **Target repo:** obsidian-gantt
- **Goal:** Make the local fork build (U1/U2) consumable by the e2e harness and the dev vault so M3 behavior can be verified end-to-end.
- **Requirements:** enables R8/R9/R12 verification (KTD7).
- **Dependencies:** U1, U2 (a built fork artifact to point at).
- **Files:**
  - `test/wdio/wdio.conf.mts` — behind an env gate (e.g. `TASKNOTES_LOCAL_BUILD=<path>`), replace the pinned `{repo: "callumalpass/tasknotes", version: "4.11.0"}` plugin entry with `{path: <local build>}`. Default (env unset) keeps the pinned release so existing specs/CI are unaffected.
  - `docs/solutions/` or the dev-run doc — record how to build the fork (`npm run build` in the tasknotes clone) and install it into the dev vault for in-vault M3 verification.
  - Tests: n/a (test infrastructure) — validated by U4/U6 specs running green against the local build.
- **Approach:** Use the `{path}` escape hatch the wdio.conf already documents. Keep it env-gated so the default suite still pulls the reltype-blind 4.11.0 (M1/M2 specs must keep passing on that).
- **Patterns to follow:** the existing `obsidianOptions.plugins` array in `test/wdio/wdio.conf.mts`; the install-to-vault flow (`scripts/install-to-vault.cjs`).
- **Test scenarios:** `Test expectation: none -- test infrastructure; exercised by U4/U6 e2e specs.`
- **Verification:** with the env var set, the dependency e2e boots against the local fork build (confirm via a TaskNotes version/marker probe); with it unset, the suite is unchanged.

### U4. Create FF/SS/SF dependencies via handle geometry (#86)

- **Target repo:** obsidian-gantt
- **Goal:** Let a drag between bars author any of the four reltypes from the handle geometry, persisted to `blockedBy`.
- **Requirements:** R8; extends AE3 to non-FS.
- **Dependencies:** U2 (gating correctness), U3 (e2e), and the M2 write path (shipped).
- **Files:**
  - `src/bases/cascadeGate.ts` — extend `classifyLinkCreate` to return `{predecessor, dependent, reltype}` for all four geometries via an SVAR-type→reltype map (inverse of `RELTYPE_TO_SVAR`); still reject self-links and unknown types.
  - `src/controller/GanttController.ts` — surface the inverse map (or a shared `SVAR_TO_RELTYPE`) and stop hardcoding `FINISHTOSTART` in `addDependency` (pass the classified reltype through).
  - `src/bases/GanttContainer.svelte` — `add-link` intercept: drop the "FS only" Notice/rejection; pass `reltype` from `classifyLinkCreate` to `controller.addDependency`.
  - Tests: `test/unit/cascadeGate.test.ts` (the four geometries + self-link), `test/unit/GanttController.write.test.ts` (reltype passthrough), `test/specs/gantt-dependency-types.e2e.ts` (author non-FS, gated on `TASKNOTES_LOCAL_BUILD`).
- **Approach:** Mirror M2's `classifyLinkCreate`/intercept; the only new logic is the type→reltype mapping and removing the FS-only guard. `addDependency`'s signature is unchanged.
- **Patterns to follow:** M2's `classifyLinkCreate` and the `add-link` intercept in `GanttContainer.svelte`; `RELTYPE_TO_SVAR`.
- **Test scenarios:**
  - `classifyLinkCreate` maps `s2s`→`STARTTOSTART`, `e2e`→`FINISHTOFINISH`, `s2e`→`STARTTOFINISH`, `e2s`→`FINISHTOSTART`, each with `predecessor=source`, `dependent=target`.
  - Self-link (any geometry) → `null`.
  - **Covers AE-extension of AE3.** An `s2s` drag A→B calls `controller.addDependency(A, B, "STARTTOSTART")`; B's note gains `{uid:[[A]], reltype:STARTTOSTART}`.
  - Reversed drag yields a different reltype (the geometry's), never an inverted FS.
  - e2e (local build): authoring an `s2s` link persists it and TaskNotes does **not** mark B blocked (the UT payoff, ties to AE7).
- **Verification:** in-vault (fork build), dragging the four handle combinations creates the four reltypes, each persisting and rendering with its M1 anchor geometry.

### U5. `updateDependency` — edit an edge's reltype + gap (source + controller)

- **Target repo:** obsidian-gantt
- **Goal:** Add an in-place edge-update write to the data-source abstraction and controller.
- **Requirements:** R9 (write side).
- **Dependencies:** U2 (so a changed-to-non-FS edge behaves correctly).
- **Files:**
  - `src/datasource/types.ts` — add write-gated `updateDependency(dependentPath, predecessorPath, reltype, gap?, context?)` to `DataSource`, mirroring `add`/`removeDependency`.
  - `src/datasource/TaskNotesSource.ts` — implement: read raw `blockedBy`, find the entry whose `uid` resolves to `predecessorPath`, rewrite its `reltype`/`gap` in place (omit `gap` when clearing), write the whole array via `tasks.update`. No-op (or throw) if no matching edge.
  - `src/datasource/CompositeSource.ts` — delegate to the enrichment source.
  - `src/controller/GanttController.ts` — `updateDependency(predInstanceId, depInstanceId, reltype, gap?)`: resolve both instance ids → source paths, gate on `capabilities.write`, mint a `correlationId`, recompute.
  - Tests: `test/unit/TaskNotesSource.test.ts`, `test/unit/CompositeSource.test.ts`, `test/unit/GanttController.write.test.ts`.
- **Approach:** Mirror `addDependency`'s read-modify-write, but locate-and-replace instead of append. Preserve `uid` and position; only `reltype`/`gap` change.
- **Patterns to follow:** M2's `addDependency`/`removeDependency` in `TaskNotesSource` (raw `blockedBy` read, `resolveEdgePath`, `toWikilink`); the controller's `resolveWritablePair` + correlationId.
- **Test scenarios:**
  - `updateDependency` changes a matching edge's reltype FS→SS, preserving `uid` and other edges untouched.
  - Setting `gap="P2D"` adds the gap; passing `gap=undefined`/empty clears it (no `gap` key written).
  - No matching predecessor edge → no-op/throw (documented), no array mutation.
  - `MutationContext`/correlationId forwarded to `tasks.update`.
  - CompositeSource delegates; absent when read-only.
  - Controller resolves instance ids → source paths and calls the source with resolved paths; unavailable on a read-only source.
- **Verification:** unit suite green; an edge updated via `updateDependency` reads back with the new reltype/gap via `getDependencies`.

### U6. Link context-menu — edit reltype + gap from the chart (#87)

- **Target repo:** obsidian-gantt
- **Goal:** Right-clicking a rendered arrow opens a menu to change its reltype and set/clear its gap, persisted via U5.
- **Requirements:** R9 (UI); R3 (reltype/gap visible/editable without leaving the Gantt).
- **Dependencies:** U5.
- **Files:**
  - `src/bases/GanttContainer.svelte` — extend the existing root `contextmenu` handler to also match `svg.wx-links g.wx-line[data-link-id]` (strip SVAR's `:` id prefix); resolve the link id → its `RenderLink` (via `appliedLinks`) → predecessor/dependent instance ids + current reltype/gap; build an Obsidian `Menu` with a reltype submenu (four items, current checked) and "Set gap…"/"Clear gap"; on selection call `controller.updateDependency(...)`. Gate on `!readOnly && onUpdateDependency`.
  - A small gap-input modal (mirror `CascadeConfirmModal` construction) or reuse an existing input prompt; days → `P{n}D`.
  - `src/bases/register.ts` — wire an `onUpdateDependency` mount prop to `controller.updateDependency` (mirror `onAddDependency`/`onRemoveDependency`).
  - Tests: the menu→controller glue is thin (covered at the U5 controller seam); pure helpers (id→roles+current reltype, days↔ISO `P{n}D`) extracted and unit-tested; e2e gated on the local build if feasible.
- **Approach:** Mirror the bar context-menu path (`onBarContextMenu`) and M2's link-id resolution (`appliedLinks`, `:`-prefix strip). The menu is Obsidian-native (consistent with the rest of the plugin's menus).
- **Patterns to follow:** the existing `contextmenu` handler + `onBarContextMenu` in `GanttContainer.svelte`; `appliedLinks` link-id resolution from M2's `delete-link` intercept; `CascadeConfirmModal` for the modal shape.
- **Test scenarios:**
  - Pure helper: a `data-link-id` (`:src->tgt:type:gap`) resolves to predecessor/dependent + current reltype/gap.
  - Pure helper: days→ISO (`2`→`P2D`) and ISO→days for pre-filling the input; clear → undefined.
  - Choosing a new reltype calls `controller.updateDependency(pred, dep, newReltype, currentGap)`.
  - Setting a gap calls update with the new gap; clearing passes undefined.
  - Read-only mode: no link context menu fires.
  - e2e (local build, if feasible): right-click an arrow, change FS→SS, reload → the note's edge shows the new reltype.
- **Verification:** in-vault (fork build), right-clicking an arrow lets the user switch reltype and set/clear gap; the change persists and the arrow re-renders with the new geometry/gap.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- **PR to `callumalpass/tasknotes`** for the UT (R12) change — tracked separately; this plan ships the fork build (KTD7).
- **CI coverage of UT-dependent behavior** — until a fork release is pinnable, the non-FS e2e runs locally behind `TASKNOTES_LOCAL_BUILD`; CI keeps the reltype-blind 4.11.0 (see Risks).
- **Lead (negative gap)** — M3 ships lag (≥0) + clear; lead exposed only if the TaskNotes round-trip is confirmed trivial (KTD6).
- **Dependency cascade on a move** — M4 (#88–#90); the `SchedulingEngine` is reltype-aware independently of UT.
- **Keyboard/command dependency authoring** — SVAR authoring is drag-only; a command path is a future alternative.

### Outside this product's identity

- Re-implementing TaskNotes' blocked-state logic inside the Gantt to compensate for reltype-blindness — fixed upstream via UT instead.
- A plugin-owned dependency store (TaskNotes' `blockedBy` is system-of-record).
- A second write capability dedicated to dependencies (rides the single `capabilities.write`, origin R4).

---

## Risks & Dependencies

- **UT data-model change is broader than `isBlocked` (medium).** The reltype must be threaded through `DependencyCache`'s index structures and signature, not just the final predicate (Problem Frame). Mitigation: U1 isolates the data-model change with its own tests before U2 touches logic; FS-only regression battery in U2 guards existing behavior.
- **Consumer audit (low–medium).** R12 names views/filters/auto-unblock; the design routes correctness through `isTaskBlocked`/`getBlocked*` so consumers inherit it, but a consumer that reads the raw index or assumes reltype-blind semantics would need a touch. Mitigation: U2 explicitly audits `TaskManager`, `bases/helpers.ts`, `taskPropertyChangeSideEffects.ts`.
- **CI cannot exercise reltype-aware behavior (medium, accepted).** The harness pins upstream 4.11.0 (reltype-blind). Per KTD7, the non-FS e2e is local-only behind an env gate until a fork release. Mitigation: blocked-state logic is unit-tested in tasknotes (U1/U2); gantt authoring/edit is unit-tested (U4/U5/U6); the cross-repo e2e is a local gate. Recorded as a Deferred follow-up.
- **SVAR `e2s`/`s2s`/`e2e`/`s2e` source/target convention (low — verify).** Direction is derived from handle geometry; confirm against installed SVAR 2.7.0 at execution (same residual unknown M2 flagged for `e2s`). The four-way map is symmetric, so confirming one anchor convention validates all.
- **Gap representation (low).** TaskNotes stores `gap` verbatim; confirm the `P{n}D` shape round-trips and decide lead handling at implementation (KTD6).
- **Cross-repo build/version drift (low).** The dev vault and e2e must run the *same* fork build that has U1/U2. Mitigation: U3 documents the build+install flow; a version/marker probe in the e2e asserts the local build is active.

---

## Deferred to Implementation

- Exact `DependencyCache` index shape (`Map<path, Map<path, reltype>>` vs a record set) — pick during U1 for clean cleanup semantics.
- Whether `getBlockingTaskPaths`/`getBlockedTaskPaths` keep path-only return types with reltype-aware *filtering*, or gain reltype-carrying variants — decide by what consumers actually need (U2 audit).
- The exact SVAR `add-link` source/target direction for non-`e2s` geometries — confirm against SVAR 2.7.0 (U4).
- TaskNotes `gap` round-trip + lead/negative representation (U6/KTD6).
- Whether the gap input is a dedicated modal or an inline prompt (U6).

---

## Sources & Research

- Origin requirements: [docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md](docs/brainstorms/2026-06-18-gantt-dependency-types-and-scheduling-requirements.md) (R8, R9, R12, AE7; cross-repo note + tasknotes clone path in Dependencies/Assumptions).
- M2 plan (write-path reuse): [docs/plans/2026-06-19-001-feat-gantt-fs-link-authoring-plan.md](docs/plans/2026-06-19-001-feat-gantt-fs-link-authoring-plan.md).
- obsidian-gantt extension points: [src/bases/cascadeGate.ts](src/bases/cascadeGate.ts) (`classifyLinkCreate`), [src/controller/GanttController.ts](src/controller/GanttController.ts) (`RELTYPE_TO_SVAR`, `addDependency`), [src/bases/GanttContainer.svelte](src/bases/GanttContainer.svelte) (`add-link` intercept, contextmenu handler, `appliedLinks`), [src/datasource/types.ts](src/datasource/types.ts), [src/datasource/TaskNotesSource.ts](src/datasource/TaskNotesSource.ts), [src/datasource/CompositeSource.ts](src/datasource/CompositeSource.ts).
- TaskNotes (fork) reltype-blindness: `src/utils/DependencyCache.ts` (`indexTaskFile` drops reltype; `isTaskBlocked`), `src/utils/TaskManager.ts`, `src/bases/helpers.ts`, `src/services/task-service/taskPropertyChangeSideEffects.ts`, `src/utils/dependencyUtils.ts` (`TaskDependency`, `normalizeDependencyEntry`, `serializeDependencies` — the `{uid, reltype, gap?}` contract).
- e2e harness `{path}` escape hatch: [test/wdio/wdio.conf.mts](test/wdio/wdio.conf.mts).
- Memory: `tasknotes-reltype-blind-dependencies` (the harmonization stance).
