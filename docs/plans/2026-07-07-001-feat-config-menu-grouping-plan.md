---
title: Base View Config Menu Grouping - Plan
type: feat
date: 2026-07-07
topic: config-menu-grouping
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Base View Config Menu Grouping - Plan

## Goal Capsule

- **Objective:** Make the Gantt Bases view config menu navigable by organizing its ~24 flat settings into five collapsible sections, with a targeted rename/reorder of the opacity slider and a regrouping of the progress controls.
- **Product authority:** Maintainer (renatomen).
- **Open blockers:** None. One item is deferred to implementation: whether Bases renders option groups expanded by default (A1, gating R6) — resolved by U4's real-Obsidian check, not during planning.

---

## Product Contract

### Summary

Reorganize the Gantt view's Bases config menu into five collapsible sections built on Bases' native option groups: **Fields, Progress, Relationships, Timeline, Appearance**. Rename the "Context bar opacity (%)" slider to "Expanded items opacity (%)" and move it under *Expanded relationships*; regroup *Progress mode* next to *Progress Property*. A settings search box was evaluated and deferred as not achievable within the standard Bases API.

### Problem Frame

The Gantt view exposes roughly two dozen per-view settings as a single flat list in the Bases view-config menu. The list has grown long enough that finding a specific setting means scanning the whole thing, and related settings sit far apart — the opacity slider that tunes expanded-item context bars lands three rows below the *Expanded relationships* control it belongs with, and the progress-source dropdown is separated from the progress property it depends on. TaskNotes' calendar view solves the same length problem with expandable, logically-grouped sections; this brings the same navigability to the Gantt config menu.

### Key Decisions

- **Progress gets its own section.** *Progress Property* leaves the Fields group so *Progress mode* can sit directly beside the property it reads — grouping by concept rather than keeping every property-mapping together.
- **Five sections, not seven.** *Task visibility* folds into Timeline and *Layout* folds into Appearance, trading shorter sections for fewer headers to scan.
- **Native Bases option groups only.** Sectioning uses the documented `BasesOptionGroup` collapsible container; no custom menu rendering, honoring the "no hacks" constraint.
- **Rename is label-only.** The persisted config key behind the opacity slider is unchanged, so existing views keep their saved value across the rename.

### Requirements

**Rename and reorder the opacity slider**

- R1. The slider labeled "Context bar opacity (%)" is renamed to "Expanded items opacity (%)". The change is to the display label only; the persisted config key is unchanged.
- R2. The renamed slider is positioned in the Relationships section immediately after *Expanded relationships* and above *Hide top-level subtasks*.

**Regroup the progress controls**

- R3. *Progress Property* and *Progress mode* are presented together in a dedicated Progress section, with *Progress mode* immediately following *Progress Property*.

**Section the menu**

- R4. The Gantt view config menu is organized into five collapsible sections using Bases' native option groups, in this top-to-bottom order: Fields, Progress, Relationships, Timeline, Appearance.
- R5. Section membership is:
  - **Fields** — Task Name Property, Start Date Property, End Date Property, Parent Property, Status Property, Priority Property.
  - **Progress** — Progress Property (always shown), Progress mode (companion-only).
  - **Relationships** (companion-only) — Expanded relationships, Expanded items opacity (%), Hide top-level subtasks.
  - **Timeline** — Default Scale, Default task duration (days), Dependency Arrows, Parent date updates, Show tasks with no dates, Show tasks with only one date.
  - **Appearance** — Bar color mode, Bar color source, Task icon, Show date-status indicators on bars, Show toolbar, Min height (px), Max height (px).
- R6. All five sections render expanded when the config menu opens. (Achievable only if Bases renders groups expanded by default — see A1.)
- R7. The Relationships section and the Progress-mode control are hidden when TaskNotes is absent; the Progress section itself and Progress Property remain, since standalone views still map a progress property to drive progress bars. This preserves today's behavior where a standalone user sees no inert companion controls.

### Scope Boundaries

- **Settings search box — out of scope.** The standard Bases API cannot filter the option list live: filtering would depend on Bases re-evaluating each option's `shouldHide` predicate on every keystroke (undocumented, and options are almost certainly rendered once), and the only query holder is a `text` option whose value persists into the `.base` file. Dropped without a spike; it fails the "no hacks" constraint as verified.
- **No global plugin settings tab.** Per-view config is the established model for this plugin.
- **TaskList view menu not restructured.** The sibling `obsidianGanttTaskList` view inherits only the shared Fields grouping; its full menu is not redesigned here.
- **One level of grouping only.** Bases option groups hold leaf controls, not other groups — no sub-sections.

### Dependencies / Assumptions

- A1. Bases renders option groups expanded by default. The `BasesOptionGroup` type exposes no initial-state field, so if Bases defaults groups to collapsed, R6 is not achievable without a hack and would be dropped.
- A2. The field-mapping options are shared with the `obsidianGanttTaskList` view via a single shared options builder. Wrapping them in a Fields group and relocating Progress Property affects both views, and both config readers must stay in sync — this view has a prior reader-drift bug (see [tasklist-view-tngantt-config-keys.md](docs/solutions/integration-issues/tasklist-view-tngantt-config-keys.md)).
- A3. The build already targets an Obsidian version with native option groups (`BasesOptionGroup`, since 1.10.0) and the `shouldHide` predicate (since 1.10.2); `minAppVersion` is 1.10.0 and the plugin builds against 1.13.1.

### Outstanding Questions

**Resolved during planning** (see Key Technical Decisions)

- Progress Property in the TaskList view stays in that view's Fields group; only the Gantt view splits it into a Progress section (KTD3).
- Companion gating uses the existing conditional-construction pattern, not `shouldHide` (KTD4).

**Deferred to implementation**

- Empirical verification of A1 (default expand/collapse state of native option groups) — resolved by the Verification Contract's real-Obsidian check, not by planning.

### Sources / Research

- [src/bases/viewOptions.ts](src/bases/viewOptions.ts) — the option builders: `sharedFieldMappingOptions`, `relationshipOptions`, `ganttViewOptions`. The opacity slider (`tngantt_contextOpacity`) currently sits inside `relationshipOptions` after *Hide top-level subtasks*.
- `node_modules/obsidian/obsidian.d.ts` — `BasesAllOptions`, `BasesOptionGroup` (documented "Collapsible container for other ViewOptions"), `BasesTextOption`, and the `shouldHide?: () => boolean` predicate on `BasesOption` / `BasesOptionGroup`.
- [docs/solutions/integration-issues/tasklist-view-tngantt-config-keys.md](docs/solutions/integration-issues/tasklist-view-tngantt-config-keys.md) — prior drift between the two config readers that share the field-mapping options.

---

## Planning Contract

**Product Contract preservation:** unchanged. This enrichment adds HOW (units, verification) without altering any R-ID, scope boundary, or success signal.

### Key Technical Decisions

- KTD1. **Views compose groups; the shared builder stays flat.** `sharedFieldMappingOptions()` keeps returning the flat array of leaf property options (the single source of each field's label, key, placeholder, default). Grouping is assembled per view — `ganttViewOptions()` and `taskListViewOptions()` wrap those leaves into `type: 'group'` containers. This avoids duplicating field definitions and lets the two views group differently (Gantt splits Progress Property out; TaskList does not). Narrow the leaf builders' return type from `BasesAllOptions[]` to the concrete leaf-option type (`BasesOptions[]`) so their output is assignable to a group's `items: BasesOptions[]` under strict TypeScript — `BasesOptionGroup` items are leaves, not nested groups, so the current `BasesAllOptions[]` return type would not type-check when wrapped.
- KTD2. **Rename is label-only; the key and reader are untouched.** Only the `displayName` of the `tngantt_contextOpacity` slider changes to "Expanded items opacity (%)". The config key, `readContextOpacity`, `DEFAULT_CONTEXT_OPACITY`, and the `--tng-*` CSS custom property stay as-is, so saved views and the render path are undisturbed (satisfies R1's key-stability clause). Renaming the reader/key would be a breaking config migration for no user benefit.
- KTD3. **Progress Property is always shown; only Progress mode is companion-gated.** The Progress group is always rendered and always contains Progress Property (standalone Gantt and TaskList both read `progressProperty` to drive progress bars — removing it is a regression). Progress mode is the only companion-only member of that group. In the TaskList view, Progress Property stays in the Fields group (that view has no Progress mode), so its menu is a single Fields group over all seven mappings. In standalone Gantt the Progress section holds only Progress Property; a one-control section is accepted deliberately rather than conditionally folding it back into Fields — keeping group composition uniform across companion states is simpler than a standalone-only reshuffle, and the header cost is trivial.
- KTD4. **Companion gating via conditional construction, not `shouldHide`.** Mirror the existing `companionAvailable ? [...] : []` pattern already used in `ganttViewOptions`: the Relationships group and the Progress-mode item are built only when TaskNotes is present. This keeps behavior identical to today and avoids depending on the undocumented reactive re-evaluation of `shouldHide` (the same reactivity gap that killed the search feature).
- KTD5. **R6 "expanded by default" is best-effort and behavior-only.** The API has no initial-state field (A1), so implementation just declares the groups; the expand state is whatever Bases renders. The real-Obsidian check resolves A1: if Bases defaults to collapsed and offers no control, R6 is documented as not-achievable rather than forced with a hack.

### High-Level Technical Design

The change is a pure restructuring of the option-descriptor arrays returned by two builder functions. The load-bearing logic is which sections/items appear per companion state:

| Section (group) | Members | Gantt + TaskNotes | Gantt standalone | TaskList view |
|---|---|---|---|---|
| Fields | Task Name, Start, End, Parent, Status, Priority | shown | shown | shown (+ Progress Property) |
| Progress | Progress Property (+ Progress mode) | both shown | Property only | n/a (Progress Property lives in Fields) |
| Relationships | Expanded relationships, Expanded items opacity (%), Hide top-level subtasks | shown | omitted | n/a |
| Timeline | Default Scale, Default task duration, Dependency Arrows, Parent date updates, Show tasks with no dates, Show tasks with only one date | shown | shown | n/a |
| Appearance | Bar color mode, Bar color source, Task icon, Show date-status indicators, Show toolbar, Min height, Max height | shown | shown | n/a |

Directional shape only — the per-unit fields below are authoritative for what changes.

### Sequencing

U1 (rename) is independent and lands first. U2 (Gantt grouping) is the core change and subsumes the opacity slider's reorder. U3 (TaskList Fields group) is independent of U2 but shares the test-helper update, so it lands after U2. U4 verifies rendering in real Obsidian last.

---

## Implementation Units

### U1. Rename the opacity slider label

- **Goal:** Rename the slider from "Context bar opacity (%)" to "Expanded items opacity (%)" without touching its config key or readers.
- **Requirements:** R1.
- **Dependencies:** none.
- **Files:** `src/bases/viewOptions.ts`, `test/unit/viewOptions.test.ts`.
- **Approach:** Change only the `displayName` on the `tngantt_contextOpacity` slider descriptor. Leave `key`, `default`, `min`, `readContextOpacity`, and `DEFAULT_CONTEXT_OPACITY` unchanged (KTD2).
- **Patterns to follow:** the existing slider descriptor in `relationshipOptions`.
- **Test scenarios:**
  - Happy path: the option with key `tngantt_contextOpacity` has `displayName` "Expanded items opacity (%)".
  - Regression guard: its `key`, `default`, and `min` are unchanged from current values; `readContextOpacity` still resolves stored percentages to the same 0–1 fraction.
- **Verification:** `npm test` green; the renamed-label assertion passes and no reader test regresses.

### U2. Group the Gantt config menu into five collapsible sections

- **Goal:** Restructure `ganttViewOptions()` to return five `BasesOptionGroup` containers (Fields, Progress, Relationships, Timeline, Appearance) with the membership and order in R5, correct intra-group order, and companion gating.
- **Requirements:** R2, R3, R4, R5, R7 (R6 declared here, verified in U4).
- **Dependencies:** U1.
- **Files:** `src/bases/viewOptions.ts`, `test/unit/viewOptions.test.ts`.
- **Approach:** Assemble groups from the flat leaf options (KTD1). Partition `sharedFieldMappingOptions()` by key: the six non-progress mappings go into the **Fields** group; `FIELD_MAPPING_KEYS.progress` moves into the **Progress** group, followed by the Progress-mode dropdown (built only when `companionAvailable`, KTD4). The **Relationships** group holds Expanded relationships → Expanded items opacity slider → Hide top-level subtasks in that order (R2), built only when `companionAvailable` (R7, KTD4). **Timeline** and **Appearance** collect the remaining existing options per R5. Each group is `{ type: 'group', displayName, items }`. Update the `byKey` test helper to recurse into `group.items`, and update **every** existing test that iterates the top-level option array — the standalone-keys test, the shared-property-mapping-order test, and the total-option-count assertion — to flatten groups before mapping/counting keys (post-grouping the top-level entries are `type: 'group'`, so a flat `filter`/`toHaveLength` over them silently breaks).
- **Technical design (directional):** group shape is `{ type: 'group', displayName: 'Fields', items: [...leafOptions] }`; do not nest groups (one level only). Do not set any expand-state field — none exists.
- **Patterns to follow:** the current `companionAvailable ? [...] : []` conditional spreading in `ganttViewOptions`; the `Record<string,string>` dropdown option maps already in the file.
- **Test scenarios:**
  - Happy path: `ganttViewOptions()` returns exactly five groups; each has `type: 'group'` and the R5 members in R5 order; groups appear in Fields → Progress → Relationships → Timeline → Appearance order.
  - Intra-group order: within Relationships, `tngantt_contextOpacity` sits immediately after `tngantt_expandedRelationships` and before `tngantt_hideTopLevelSubtasks` (R2). Within Progress, `tngantt_progressMode` immediately follows the progress-property option (R3).
  - Companion off (`ganttViewOptions(false)`): no Relationships group; no `tngantt_progressMode` item; the Progress group still contains the progress-property option; Fields/Timeline/Appearance groups present (R7). Preserves the existing standalone-keys assertions (recursing into groups).
  - Regression: every previously-present key still resolves via a flattened lookup; no key added or removed beyond the intended moves.
- **Verification:** `npm test` green including the new group-structure tests and the updated existing tests.

### U3. Wrap the TaskList view's field mappings in a Fields group

- **Goal:** Give the TaskList view config menu a single **Fields** group over all seven mappings (including Progress Property), so it gets a header without a Progress/Relationships split.
- **Requirements:** R4 (Fields grouping applied to the shared surface), KTD3.
- **Dependencies:** U2 (shares the `byKey` helper update).
- **Files:** `src/bases/viewOptions.ts`, `test/unit/viewOptions.test.ts`.
- **Approach:** Wrap `sharedFieldMappingOptions()` in a single `{ type: 'group', displayName: 'Fields', items }` inside `taskListViewOptions()`. Confirm `GanttTaskListView.getFieldMappings()` is unaffected — it reads flat via `config.get(key)`, so grouping the descriptors doesn't change what it reads (A2 guard against reader drift).
- **Patterns to follow:** U2's group construction.
- **Test scenarios:**
  - Happy path: `taskListViewOptions()` returns one Fields group containing all seven mapping keys including `FIELD_MAPPING_KEYS.progress`.
  - Regression: the field-mapping keys and defaults are unchanged from the current flat output (flattened comparison).
- **Verification:** `npm test` green; TaskList field-mapping tests pass.

### U4. Verify collapsible rendering and default expand state in real Obsidian

- **Goal:** Confirm the Gantt config menu renders the five sections (correct order, membership, companion gating) and resolve A1 — whether they open expanded.
- **Requirements:** R6, and real-Obsidian confirmation of R4/R5/R7.
- **Dependencies:** U2, U3.
- **Files:** `test/specs/` (a targeted e2e spec) or a documented manual-verification note if the native view-config panel proves impractical to drive via WebdriverIO.
- **Approach:** Open a Base with the Gantt view, open the view-config menu, assert the five section headers appear in order with their members, and observe the default expand state. In a standalone (no-TaskNotes) run, confirm the Relationships group and Progress mode are absent while Progress Property remains. Record the A1 outcome in the plan/PR: if Bases renders groups collapsed with no control, note R6 as not-achievable rather than hacking it.
- **Execution note:** unit tests (U1–U3) are the primary correctness proof for structure; this unit adds the real-Obsidian rendering + expand-state confirmation the unit layer cannot give. Prefer the fastest reliable check — a focused e2e if the panel is driveable, otherwise a maintainer manual check.
- **Test scenarios:**
  - Companion present: five section headers render in order; members match R5.
  - Standalone: Relationships group and Progress mode absent; Fields/Progress(Property)/Timeline/Appearance present.
  - Expand state: sections are expanded on open (or A1 documented as not-controllable).
- **Verification:** `npm run e2e:local` relevant spec green, or a recorded manual-verification result plus the A1 determination.

---

## Verification Contract

| Gate | Command | Applies to | Done signal |
|---|---|---|---|
| Unit tests | `npm test` | U1, U2, U3 | Green, including new group-structure tests and updated `byKey`/standalone-keys tests |
| Types + lint | `npm run build` (svelte-check + esbuild) | all | No type or lint errors |
| Real-Obsidian render | `npm run e2e:local` (relevant spec) or documented manual check | U4 | Five sections render with correct order/membership/gating; A1 expand-state outcome recorded |

Companion and standalone paths must both be exercised (`ganttViewOptions()` and `ganttViewOptions(false)`).

---

## Definition of Done

- R1–R5 and R7 satisfied and covered by unit tests; R6 satisfied or its non-achievability documented per KTD5/A1.
- No config-key changes — existing views retain their saved settings (KTD2).
- The shared field-mapping builder stays the single source of field definitions; Gantt and TaskList compose their own groups (KTD1, KTD3).
- `GanttTaskListView` still reads all field mappings correctly (A2 — no reader drift).
- `npm test` and `npm run build` green; U4's real-Obsidian check completed with its A1 result recorded.
