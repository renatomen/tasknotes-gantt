---
title: "refactor: adopt official obsidian 1.13 Bases API types"
type: refactor
status: active
date: 2026-06-21
last_updated: 2026-06-21
---

# refactor: adopt official obsidian 1.13 Bases API types

## Summary

Replace the hand-rolled Bases type vocabulary and the `declare module 'obsidian'` augmentation in [src/bases/register.ts](src/bases/register.ts) with the **official** Bases API types shipped in obsidian 1.10+ (targeting 1.13.x), and reparent the local `GanttBasesView` base class onto the official abstract `BasesView`. This removes the reason `obsidian` is pinned to exactly `1.8.7` (PR #143) and deletes a now-redundant parallel type system.

This is a **runtime-behavior-neutral** refactor: it changes type declarations and the small amount of view-registration glue, not what the Gantt/TaskList views render. **It is NOT a "zero `any`" refactor** — see KTD 4: Obsidian's public `BasesEntry`/`Value` types deliberately expose *less* than the runtime objects the data adapter reads, so the value-extraction boundary keeps its existing documented loose access. The migration adopts official types for the large *typed* surface (view base class, registration, config, factory, controller) and is honest about the one seam that cannot be expressed against the public API.

Produced via `/lfg` (pipeline mode); hardened by a `ce-doc-review` pass that corrected the original over-optimistic "behavior-neutral + no loosening" framing. It is the follow-up flagged in PR #143.

---

## Problem Frame

`obsidian` is pinned to **exactly `1.8.7`** because that published typings version predates the Bases API. To compile, [src/bases/register.ts](src/bases/register.ts) hand-declares a parallel Bases vocabulary (`BasesPropertyId`, `BasesEntry`, `BasesValue`, `BasesEntryGroup`, `BasesQueryResult`, `BasesViewConfig`, `QueryController`, `ViewOption` + subtypes, `BasesViewFactory`, `BasesViewRegistration`) plus a `declare module 'obsidian'` augmentation adding `registerBasesView()` to `Plugin`.

obsidian 1.10+ ships **official** versions of all of these. Verified: upgrading to `^1.8.7` resolves to 1.13.1 and the official `Plugin.registerBasesView` **merges** with the local augmentation into an overload set → 2 "No overload matches this call" errors (register.ts ~727, ~814). The official `BasesView` also requires a `createFileForView` member the local `GanttBasesView` (extends `Component`) lacks.

The local vocabulary is also *looser* than official and worth retiring — but the official surface is in places *narrower* than the runtime, which constrains how far the migration can tighten (see KTD 4). Verified against `node_modules/obsidian/obsidian.d.ts` @ 1.13.1:

- `BasesPropertyId`: local `string`; official `` `${BasesPropertyType}.${string}` `` (template literal, `note.`/`file.`/`formula.`).
- `BasesEntry` (official ~685): a **class** exposing only `file: TFile` and `getValue(propertyId): Value | null`. It does **not** declare `frontmatter` or `properties` — which [BasesDataAdapter.ts](src/bases/services/BasesDataAdapter.ts) currently reads on its fast path.
- `Value` (official ~7246): **abstract**, with only `toString/isTruthy/equals/looseEquals/renderTo`. None of `.data/.date/.file/.at()/.length()` that `convertValueToNative()` reads, and the concrete subclasses (`PrimitiveValue`/`DateValue`/`FileValue`/`ListValue`/`NullValue`) are **not exported**.
- `BasesViewConfig` (official ~1166): a **class** with `get()/getAsPropertyId()/getEvaluatedFormula()/set()/getOrder()/getSort(): BasesSortConfig[]/getDisplayName()`.

## Goals / Definition of Done

- `obsidian` upgraded from exact `1.8.7` to `^1.13.x`; **`package-lock.json` regenerated** so a clean CI install resolves 1.13.x (today the lockfile still pins 1.8.7 even though local `node_modules` drifted to 1.13.1).
- The `declare module 'obsidian'` augmentation and the redundant local Bases type definitions in `register.ts` are deleted; official types imported from `'obsidian'`.
- `GanttBasesView` extends the official `BasesView`; the `app`-from-controller hack and redundant member redeclarations are removed. **If the base class adds nothing after that, collapse it in this PR** (subclasses extend `BasesView` directly) rather than leaving an empty forwarding class.
- All consumer files compile against the official types. **No NEW loosening is introduced** for the typed surface (view classes, registration, config, factory). The data-extraction boundary in `BasesDataAdapter` keeps its **existing** `any`/cast access to runtime members (status quo, not a regression) — documented explicitly, not silently (KTD 4).
- `svelte-check` **0 errors**, `npm run build` green, **483 unit tests** green (fixtures/mocks updated to the official `BasesEntry`/`Value` shape — see U3), **e2e green** with a strengthened assertion that a real `note.*` value reads **non-null** end-to-end (not merely "the view renders").
- No change to rendered Gantt/TaskList behavior; no new toolbar/menu affordance (KTD 1 / Risks).
- Single PR through existing CI (build + e2e + Test+coverage + Analyze), merge-when-green.

---

## Key Technical Decisions

1. **Reparent `GanttBasesView` onto the official `BasesView`** (`extends BasesView`). The official abstract `BasesView` (~1105) provides exactly what the local base reimplements — `abstract type`, `app`, `config`, `data`, `allProperties`, `protected constructor(controller)`, `abstract onDataUpdated()`, and a **concrete `createFileForView()`**. Reparenting resolves the "missing `createFileForView`" error without hand-writing it and lets us delete the redundant declarations and the `this.app = (controller as …).app` hack. **After deletion the local base likely adds nothing — collapse it in this PR** unless a shared member remains.

2. **Import official Bases types from `'obsidian'`; delete the local definitions** (`BasesPropertyId`, `BasesEntry`, `BasesValue`, `BasesEntryGroup`, `BasesQueryResult`, `BasesViewConfig`, `QueryController`, `ViewOption` + `BaseViewOption`/`TextViewOption`/`NumberViewOption`/`BooleanViewOption`/`DropdownViewOption`/`PropertyViewOption`/`FormulaViewOption`, `BasesViewFactory`, `BasesViewRegistration`) and the `declare module 'obsidian'` block. Re-point every consumer import to `'obsidian'`.

3. **Move obsidian to caret `^1.13.1` and regenerate the lockfile.** The exact pin existed only to dodge the augmentation collision (PR #143); once official types are adopted the collision is gone. U1 must run an install so `package-lock.json` reflects 1.13.x — otherwise CI's clean install still resolves 1.8.7 and diverges from local.

4. **The data-extraction boundary stays pragmatically loose — and we say so.** This is the corrected core decision. Obsidian's public `BasesEntry`/`Value` deliberately expose far less than the runtime objects: `entry.frontmatter`/`entry.properties` and `value.data/.date/.constructor.name` are read by [BasesDataAdapter.ts](src/bases/services/BasesDataAdapter.ts) (~337–376) and friends, none of which exist on the official public types, and the concrete `Value` subclasses are not exported. The adapter already accesses these through `any`-typed parameters (`getPropertyValue(entry: any)`, `convertValueToNative(value: any)`, `basesView?: any`), which is why it compiles today and why the runtime is unaffected by the type swap.
   - **Decision: preserve the existing extraction path as-is. Do NOT re-route through `getValue()`** (that would be a behavior + performance change — `getValue` is the computed path the adapter deliberately avoids) and **do NOT try to express these reads against the official public `Value` API** (impossible — the shapes aren't public). Keep the reads behind a single, **documented** boundary: either retain the existing `any` parameters or introduce one narrow internal interface describing the runtime shape we rely on, with a comment citing that Obsidian's public types are intentionally narrower. The "no NEW loosening" goal applies to the *rest* of the surface, not this seam.
   - **`getValue()` is `Value | null`** — type the null branch (the adapter already guards `value == null`).
   - **`BasesPropertyId` template-literal** is read at many boundaries, not one: `FieldMappings` (field-mapping.ts) holds six bare `string` IDs (text/start/end/progress/parent/status) that flow into `extractValue(entry, propertyId: BasesPropertyId)`, plus `config.get(...) as string` sites. **Add one `asPropertyId(s: string): BasesPropertyId` narrowing helper** and route raw-string→ID conversions through it (or widen `FieldMappings` to `BasesPropertyId`); do not sprinkle ad-hoc casts. `extractValue`'s `propertyId.split('.')` logic is structurally safe under the official type.

5. **Options builders take `config` and return official option types — including two control remappings.** Change `options` from `() => ViewOption[]` to `(config: BasesViewConfig) => BasesAllOptions[]`. The official `BasesOptions` union has **no `'number'` or `'boolean'`** — the current registration's `type: 'number'` (Default task duration) becomes `BasesSliderOption` (`type: 'slider'`) and the three `type: 'boolean'` toggles (showUndatedTasks / showPartialDateTasks / showDateIndicators) become `BasesToggleOption` (`type: 'toggle'`). A slider is a different control than a number field, so this is a **minor UI-control change, not pure type-alignment** — accept it and confirm via e2e/manual that the options still work; do not add any new `shouldHide`/conditional logic in this PR (keep the same static option set).

### Alternatives considered

- **Keep local types, rename to dodge the collision** — rejected: perpetuates a looser, drift-prone parallel type system; defeats the goal.
- **Re-route value extraction through the official `getValue()` API** — rejected: behavior + perf change, out of scope for a runtime-neutral refactor (noted as possible future work).
- **Keep `GanttBasesView extends Component` + hand-implement `createFileForView`** — rejected: more code; reparenting is strictly simpler.

---

## Sequencing note (one coherent change)

Deleting the local vocabulary (U1) breaks every consumer's compile at once, so the units **cannot each be independently green** — global typecheck goes green only after U2–U5 land. They are decomposed by *file cluster* for review clarity and per-layer localization; the expectation is a **single PR**. **Keep U3 (the value-boundary work) as the last, isolated commit** so that if the strengthened e2e reveals a runtime read regression, reverting one commit restores the prior extraction path without unwinding U1's type deletions. Per-unit verification is "the type errors in this cluster are resolved," not "global typecheck passes."

## Implementation Units

### U1. Upgrade obsidian + delete the local Bases type system + regenerate lockfile

**Goal:** Move to `^1.13.1`, delete the augmentation and redundant local type defs, import official types, regenerate the lockfile.
**Dependencies:** none (entry point; intentionally produces the cascade U2–U5 resolve).
**Files:** [package.json](package.json) (obsidian `1.8.7` → `^1.13.1`), [package-lock.json](package-lock.json) (regenerated via install), [src/bases/register.ts](src/bases/register.ts) (delete local type defs ~74–220 + augmentation ~222–233; add official imports).
**Approach:** Per KTD 2/3. Run `npm install` so the lockfile resolves 1.13.x (then force-install the rollup/esbuild/@swc native binaries per the #4828 note in U6). Import `BasesView`, `BasesViewConfig`, `BasesQueryResult`, `QueryController`, `BasesPropertyId`, `BasesEntry`, `BasesViewRegistration`, `BasesViewFactory`, `BasesAllOptions`, and the specific option interfaces (`BasesTextOption`, `BasesDropdownOption`, `BasesSliderOption`, `BasesToggleOption`, `BasesPropertyOption`) from `'obsidian'`.
**Test scenarios:** Test expectation: none new — dependency/type change. Verified downstream.
**Verification:** obsidian resolves to 1.13.x in lockfile; local defs + augmentation gone; remaining errors confined to consumers.

### U2. Reparent `GanttBasesView` onto official `BasesView` (collapse if empty)

**Goal:** `GanttBasesView extends BasesView`; remove redundant members + app hack; collapse the base if it ends up empty.
**Dependencies:** U1.
**Files:** [src/bases/GanttBasesView.ts](src/bases/GanttBasesView.ts); if collapsed, [src/bases/register.ts](src/bases/register.ts) (`ObsidianGanttBasesView`) and [src/bases/views/GanttTaskListView.ts](src/bases/views/GanttTaskListView.ts) update their `extends`.
**Approach:** Import `BasesView` from `'obsidian'`; drop inherited redeclarations (`type`, `app`, `config`, `data`, `allProperties`) and the `this.app = (controller as …).app` assignment; defer to `super(controller)`. After this, if `GanttBasesView` declares nothing beyond `BasesView`, delete it and have both subclasses extend `BasesView` directly (KTD 1). **Confirm no code reads `this.app`/`this.config` during construction** (before the framework populates them) — if any does, that's a runtime regression a green typecheck won't catch; handle it.
**Test scenarios:** Test expectation: none new — structural reparenting. Covered by e2e (views must construct + mount).
**Verification:** both view classes satisfy `BasesView`; prior "missing `createFileForView`" error gone.

### U3. Reconcile the data-adapter layer (the high-risk seam)

**Goal:** Make the adapter compile against official types while **preserving the existing runtime extraction path**, and fix the test doubles to be structurally faithful.
**Dependencies:** U1 (kept as the last/isolated commit per the sequencing note).
**Files:** [src/bases/services/BasesDataAdapter.ts](src/bases/services/BasesDataAdapter.ts), [src/bases/services/PropertyMappingService.ts](src/bases/services/PropertyMappingService.ts). Tests that fabricate `BasesEntry`/`Value` doubles — enumerate and update the **actual** mock-bearing files (verify by grep before editing; the set includes BasesDataAdapter tests, [test/unit/PropertyMappingService.test.ts](test/unit/PropertyMappingService.test.ts), `BasesSource.test`, `dateFieldMapping.test`, `GanttController.test`, `propertyValues.test`, `TaskNotesSource.test`). **Note:** `test/unit/parentLink.test.ts` mocks only `App` and has **no** `BasesEntry` usage — do not include it.
**Approach:** Per KTD 4. Keep `entry.frontmatter`/`entry.properties` and `value.data/.date/.constructor.name` reads behind a single documented loose boundary (existing `any` params, or one narrow internal `interface` for the runtime shape we depend on, commented as "Obsidian's public BasesEntry/Value are intentionally narrower"). Do **not** re-route through `getValue()`. Add and use the `asPropertyId()` helper for raw-string→`BasesPropertyId` conversions. Type the `Value | null` branch. Also decide explicitly for the adapter's other `any` surface (`basesView?: any`, `extractDataItems`/`getGroupedData`/`isGrouped` consumed by `GanttTaskListView`): type against the official `BasesQueryResult`/`BasesEntryGroup` where the public API allows, or leave as the documented loose boundary — state which, don't leave it ambiguous.
**Test scenarios:**
- Happy path: a `note.*` date and a `note.*` text property extract the same value as before (regression).
- **Faithful-double guard (Covers the P0 risk):** at least one `BasesEntry` test double that exposes ONLY the official members the runtime guarantees, asserting `note.*` extraction still returns the correct non-null value — so the oracle can't pass by re-encoding the wrong `frontmatter`-present assumption.
- Edge: missing/empty property → `null` unchanged; `getValue()` returning `null` handled.
- Edge: `asPropertyId()` round-trips a configured field string to a valid `BasesPropertyId`.
**Verification:** adapter + mapping typecheck clean; their unit tests green with identical behavioral assertions (only fixtures/mocks adjusted); the faithful-double test passes.

### U4. Reconcile remaining consumers

**Goal:** Re-point imports and satisfy official types in the rest of the consumers.
**Dependencies:** U1 (and U3 for shared `BasesEntry`/`asPropertyId` usage).
**Files:** [src/datasource/BasesSource.ts](src/datasource/BasesSource.ts), [src/controller/GanttController.ts](src/controller/GanttController.ts), [src/bases/GanttContainer.svelte](src/bases/GanttContainer.svelte), [src/bases/types/field-mapping.ts](src/bases/types/field-mapping.ts), [src/bases/views/GanttTaskListView.ts](src/bases/views/GanttTaskListView.ts).
**Approach:** Change `import … from '…/register'` to `from 'obsidian'`; apply `asPropertyId()` at the `FieldMappings` string→ID boundaries (or widen the `FieldMappings` field types to `BasesPropertyId`). No behavior changes.
**Test scenarios:** Test expectation: none new — import/type realignment. Existing controller/source/tasklist tests are the regression guard.
**Verification:** these files typecheck clean; existing tests pass.

### U5. Update the two Bases view registrations + options builders

**Goal:** Align `registerBasesView` call sites with official `BasesViewRegistration`, including the number→slider / boolean→toggle remaps.
**Dependencies:** U1, U2.
**Files:** [src/bases/register.ts](src/bases/register.ts) (registration ~727 Gantt and ~814 TaskList; inline `options` ~733 and `sharedOptions`).
**Approach:** Per KTD 5. Change `options` to `(config: BasesViewConfig) => BasesAllOptions[]`. Map `type:'number'`→`BasesSliderOption`, `type:'boolean'`→`BasesToggleOption`, `type:'text'`→`BasesTextOption`, `type:'property'`→`BasesPropertyOption`, `type:'dropdown'`→`BasesDropdownOption`. Keep the same static option set; add no `shouldHide`/conditional logic.
**Test scenarios:** Test expectation: none new. e2e (both views appear, options usable) is the guard; manually confirm the slider/toggle controls behave acceptably.
**Verification:** both `registerBasesView(...)` calls typecheck with no overload errors; global `svelte-check` reports 0 errors.

### U6. Final mechanical-smell sweep + full verification

**Goal:** Clean up leftovers and verify the whole migration.
**Dependencies:** U1–U5.
**Files:** any touched above; `register.ts` doc-comment block enumerating the old hand-declared types (now obsolete).
**Approach:** Remove dead imports/comments. **Env (this machine):** fnm Node 20 + `NODE_EXTRA_CA_CERTS=Norton CA`; after the obsidian install churn, force-install rollup/esbuild/@swc native binaries (npm #4828) or build/typecheck/test fail spuriously — see the `dev-run-config` memory. Run the full local gate (typecheck, build, all unit tests); rely on CI for e2e.
**Test scenarios:** full suite — 483 tests green; no new SonarCloud smells.
**Verification:** typecheck 0 / build green / 483 tests green locally; CI green (build + e2e + Test+coverage + Analyze).

---

## Risks & Mitigations

- **(Highest) Silent `note.*` null-read regression.** Because the adapter reads runtime members not on the official public types via `any`, a green typecheck does **not** prove value extraction still works against real 1.13 entries. Mitigation: U3's faithful-double test + a **strengthened e2e assertion that a real `note.*` value reads non-null end-to-end** (not just "the view renders"). Do not merge on green typecheck alone.
- **`createFileForView` affordance.** The inherited concrete method could surface a "new note" UI affordance. Since the DoD is behavior-neutral, **if it appears, fix it in THIS PR** (override to no-op/throw) — not a follow-up. Confirm via e2e/manual that no new toolbar/menu item appears.
- **Construction-time `this.app`/`this.config` reads (U2).** Official `BasesView` populates these after construction; removing the eager `app` assignment regresses any code that reads them during construction. Mitigation: audit constructors; rely on e2e.
- **Big-bang single PR limits bisection.** Mitigation: keep U3 the last isolated commit so a one-commit revert restores the prior read path without unwinding U1.
- **`BasesPropertyId` strictness ripple.** Many string→ID boundaries. Mitigation: the single `asPropertyId()` helper (KTD 4), not scattered casts.

## Out of scope / Deferred to Follow-Up Work

- Re-routing value extraction through the official `getValue()` API (a behavior/perf change) — possible future hardening once the official `Value` subclasses are exported.
- Adopting newer Bases capabilities now available in 1.13 (formula evaluation, sort config, summary values).
- Unifying the dual build system (`scripts/build.mjs` esbuild vs `vite build`) — tracked separately.

## Verification Strategy

1. **Local gate** (fnm Node 20 + Norton CA + #4828 binary fix): `npm run typecheck` (0 errors), `npm run build` (green), `npm test` (483 pass, incl. the faithful-double test).
2. **CI** on the PR: build (windows) + e2e (windows) + Test+coverage (ubuntu) + Analyze (SonarCloud) all green.
3. **Behavior parity:** e2e asserts both Bases views register and render **and that a real `note.*` property value reads non-null**; no new UI affordance.
4. **No metric regression:** SonarCloud ratings stay A; no new smells.
