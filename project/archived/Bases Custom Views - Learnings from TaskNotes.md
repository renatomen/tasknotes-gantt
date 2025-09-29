# Obsidian Bases Custom Views – Learnings from TaskNotes

Purpose: Capture concrete patterns from TaskNotes’ Bases integration to inform how obsidian-gantt
should implement custom Bases views using obsidian-typings and resilient runtime patterns.

## 1) Registration strategy (zero-coupling, resilient)

- Version guard: `requireApiVersion('1.9.12')` before attempting Bases integration.
- Resolve Bases at runtime (no hard import):
  - `(app as any).internalPlugins.getEnabledPluginById('bases')`
  - Check for `bases?.registrations` object.
- Register custom views by writing to `bases.registrations` with a unique key:
  - `{ name, icon, factory }` where `factory` is a function receiving a Bases container-like object.
- Refresh existing Bases leaves after registration by iterating leaves with
  `view.getViewType() === 'bases'` and calling `view.refresh()` when available.
- Retry loop: If immediate registration fails (load order), retry a few times with small delays.
- Unregistration on plugin unload: delete keys from `bases.registrations`.

Implication for obsidian-gantt:

- Provide `registerBasesGantt(plugin)` mirroring this pattern:
  - Keys e.g., `ganttTimeline` (and optional `ganttKanban` if we add later)
  - Name: “Gantt (obsidian-gantt)”
  - Icon: our plugin icon id
  - Guard with API version + settings toggle.

## 2) Factory contract (view object and lifecycle)

- The factory function gets a loosely typed `basesContainer` (TaskNotes defines a
  `BasesContainerLike`). Expected fields (observed):
  - `viewContainerEl: HTMLElement` (target to render UI)
  - `results?: Map<any, any>` (query results)
  - `query?.on('change', cb)` / `query?.off('change', cb)` (react to config changes)
  - `controller?.runQuery()` & `controller?.getViewConfig()` (formula recompute & view config)
- Factory returns an object implementing:
  - `load()`, `unload()`, `destroy()`
  - `refresh()`, `onDataUpdated()`
  - `onResize()`
  - `getEphemeralState()` / `setEphemeralState(state)` (e.g., scrollTop)

Implication for obsidian-gantt:

- Build a `buildGanttViewFactory(plugin)` producing a component with the same methods.
- Manage listeners in load/unload, dispose in destroy, preserve e.g., scroll position / zoom / time
  range via ephemeral state.

## 3) Data extraction from Bases results

- `basesContainer.results` is a `Map` whose values contain:
  - `file?.path`, `path`, `properties` and/or `frontmatter`, and
    `formulaResults.cachedFormulaOutputs`.
- TaskNotes builds a normalized item:
  - Use `path` as stable key; derive title; combine `properties/frontmatter`.
  - Optional mapping via TaskNotes `FieldMapper`.

Implication for obsidian-gantt:

- Create `extractBasesItems(basesContainer)` that normalizes results into
  `{ path, properties, basesData }`.
- Map to our `GanttTask` shape; set `id = path` for consistent round-trip with editors.

## 4) Formula computation pattern

- Before rendering, TaskNotes computes Bases formulas to ensure formula fields are available:
  - Access `basesContainer.ctx.formulas` and for each item:
    - Temporarily merge TaskNote properties into `baseData.frontmatter` and call
      `formula.getValue(baseData)`.
    - Store results into `item.basesData.formulaResults.cachedFormulaOutputs[formulaName]`.
- Then render using those computed values.

Implication for obsidian-gantt:

- If the Gantt view needs formula-derived fields (e.g., computed durations/labels), run the same
  pre-render formula computation step against items.
- Keep try/catch and don’t fail the view if formulas error.

## 5) Reading Bases view configuration (grouping/sorting/visible columns)

- Visible properties (“order”):
  - Read via `query.getViewConfig('order')` or from
    `controller.getViewConfig().order / columns.order`.
  - Normalize property IDs using `query.properties` index:
    - Accept full id, trailing segment after `.`, or displayName; map all back to canonical id.
  - Map Bases ids like `task.*`, `note.*`, `file.*` to internal fields for rendering.
- Group By:
  - Read `groupBy` similarly; derive `normalizedId` and a function `getGroupValues(taskPath)` that
    returns one or many buckets (`none` for empty).
- Sort:
  - Read `sort` array; build comparator across built-ins and property ids.
  - Coerce values to primitives comparable across number/string/date.

Implication for obsidian-gantt:

- Respect Bases’ group/sort/order when presenting tasks:
  - Grouping: optional “swimlanes” or color-coding, depending on Gantt UX decisions.
  - Sorting: apply to rows within swimlanes.
  - Visible props: configure Gantt side panel/tooltip/columns accordingly.
- Implement robust id normalization against `query.properties` with displayName fallback.

## 6) Rendering and selective updates

- TaskNotes renders DOM into `viewContainerEl`, tracks a `Map<path, HTMLElement>`.
- Listens to TaskNotes `EVENT_TASK_UPDATED` and selectively re-renders a single card when possible;
  otherwise debounced full refresh.
- Also wires `query.on('change')` to re-render on Bases config changes.
- Calls `controller.runQuery()` on load to compute formulas before first paint.

Implication for obsidian-gantt:

- Maintain an index: `path -> Gantt row` to enable in-place updates on data events.
- Debounce full re-renders; prefer surgical updates (update a task’s row, dependencies, and timeline
  segment only if needed).
- Trigger `controller.runQuery()` in `load()` then a re-render.

## 7) Editing from custom views

- In Kanban, TaskNotes updates status/priority/projects/contexts via
  `plugin.updateTaskProperty(...)`.
- For arbitrary properties not owned by TaskNotes, it calls
  `app.fileManager.processFrontMatter(file, fm => { fm[propertyName] = value; })`.
- After edits, view re-renders, honoring groupBy and sort changes.

Implication for obsidian-gantt:

- For MVP, keep the Gantt view read-only or launch the upstream editor (TaskNotes modal) on
  interaction.
- If enabling inline edits in Bases Gantt, follow the same split:
  - Native TaskNotes fields: call TaskNotes APIs when present.
  - Arbitrary frontmatter fields: update via `processFrontMatter`.
- Always re-evaluate grouping/sorting after edits.

## 8) Ephemeral state and lifecycle hygiene

- Provide `getEphemeralState`/`setEphemeralState` (e.g., scrollTop) to preserve UX when Bases
  changes are applied.
- Clean up listeners (query change, event bus) on `unload`/`destroy`.

Implication for obsidian-gantt:

- Preserve Gantt zoom/scroll/time-range in ephemeral state.
- Ensure robust cleanup to avoid memory leaks across view refreshes.

## 9) obsidian-typings usage pattern

- TaskNotes does not import Bases types directly; instead it:
  - Uses `requireApiVersion` for capability gating.
  - Employs structural typing (`BasesContainerLike`) to interop safely without a compile-time
    dependency on Bases internals.
- This avoids tight coupling while benefiting from enhanced Obsidian types.

Implication for obsidian-gantt:

- Mirror structural typing for Bases containers; avoid direct dependency on Bases internal types.
- Use obsidian-typings for core Obsidian APIs and guards, but treat Bases as a dynamically
  discovered surface.

## 10) Suggested Gantt-specific application

- Registration
  - `registerBasesGantt(plugin)` with retry + refresh of existing Bases leaves.
- Factory
  - `buildGanttViewFactory(plugin)` returning lifecycle object.
  - In `load()`, call `controller.runQuery()` and then render.
- Data
  - Normalize Bases results to `{ path, properties, basesData }`.
  - Map to Gantt tasks: `id=path`, `text=title`, `startDate=scheduled`, `endDate=due`, with
    inference when missing.
- Config respect
  - Use groupBy (optional) as swimlanes or row grouping.
  - Sort comparator for row order.
  - Visible properties to configure side panel/tooltip fields.
- Formulas
  - Precompute formula outputs on items if tooltips/labels depend on them.
- Rendering
  - Render DHTMLX Gantt inside `viewContainerEl` root; track mapping `path -> ganttId`.
  - Implement `refresh()`, `onDataUpdated()`, and selective updates on task events.
- Editing (optional)
  - If TaskNotes integration toggle is on: double-click opens TaskNotes modal for that path.
  - If inline: update native fields via TaskNotes; custom frontmatter via `processFrontMatter`.
- Lifecycle
  - Manage query listeners; preserve zoom/scroll in ephemeral state.

## 11) Risks and mitigations

- Bases internals are not public API → mitigate with guards, try/catch, structural typing, and
  graceful fallback.
- Timing race at startup → retry registration + refresh leaves.
- Large result sets → selective updates, debounced refresh, and only recompute what’s visible.
- Property id drift → build normalization map from `query.properties` + display names.

## 12) Checklist for implementation

- [ ] Add settings toggle: Enable Bases integration
- [ ] Implement registration/unregistration with retries and leaf refresh
- [ ] Build factory with lifecycle methods and ephemeral state
- [ ] Implement data normalization from results Map
- [ ] Implement formula precompute (optional but recommended)
- [ ] Respect group/sort/order; build robust id normalization
- [ ] Render Gantt and maintain path→row index for selective updates
- [ ] Wire event listeners (TaskNotes updated, Bases query change)
- [ ] Implement edit routing to TaskNotes modal (if enabled)
- [ ] Tests: unit (mocks) + E2E in a bases-enabled vault fixture
