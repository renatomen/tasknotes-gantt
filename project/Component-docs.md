# Obsidian Guidance for Svelte Plugin

- https://docs.obsidian.md/Plugins/Getting+started/Use+Svelte+in+your+plugin

# SVAR Svelte Gantt

- https://docs.svar.dev/svelte/gantt/overview/

## Getting Started

https://docs.svar.dev/svelte/gantt/getting_started/

## Guides

https://docs.svar.dev/svelte/gantt/category/guides

### User Interface overview

Main UI Items

https://docs.svar.dev/svelte/gantt/guides/user-interface/

### Installation and initialisation

How to init the Gantt Widget

https://docs.svar.dev/svelte/gantt/guides/installation_initialization

### Configuration

https://docs.svar.dev/svelte/gantt/category/configuration

### Loading Data

How to load data into the Gantt widget

https://docs.svar.dev/svelte/gantt/guides/loading_data

### Fulscreen mode

How to enable the fullscreen mode and assign hotkeys

https://docs.svar.dev/svelte/gantt/guides/fullscreen

### Read-only mode

How to enable the readonly mode https://docs.svar.dev/svelte/gantt/guides/read_only_mode

### Localization

Localisation instructions https://docs.svar.dev/svelte/gantt/guides/localization

### Styling

How to add look and feel to the Gantt chart

https://docs.svar.dev/svelte/gantt/guides/styling

## Backend

https://docs.svar.dev/svelte/gantt/guides/working_with_server

## API

https://docs.svar.dev/svelte/gantt/api/overview/api_overview

### Gantt properties

activeTask Optional.Defines an active task for which the Editor dialog is opened autoScale Optional.
Allows the timescale to change dynamically its start/end dates cellBorders Optional. Defines borders
style in the Gantt chart cellHeight Optional. Defines the height of a cell in pixels cellWidth
Optional. Defines the width of a cell in pixels columns Optional. An array of objects with
configuration parameters for columns in the grid area durationUnit Optional. Defines duration unit
for tasks end Optional. Sets the end date of the timescale highlightTime Optional. Highlights
specific time areas in the chart lengthUnit Optional. Defines the minimal unit for task bars (the
task length) in a chart links Optional. Defines links between tasks in Gantt readonly Optional.
Prevents making changes to the data in Gantt scaleHeight Optional. Defines the height of the header
cell in pixels scales Optional. Defines the timescale of Gantt selected Optional. Marks tasks as
selected start Optional. Sets the start date of the timescale taskTemplate Optional. Defines your
own template for tasks bars tasks Optional. An array of objects containing the tasks types data
tasks Optional. Defines tasks in Gantt zoom Enables zooming in Gantt

### Gantt actions

add-link Fires when adding a link add-task Fires when adding a new task copy-task Fires when copying
a task delete-link Fires when deleting a link delete-task Fires when deleting a task drag-task Fires
when dragging a task expand-scale Fires when the scale does not fill all free space in the chart and
it's required to expand scale boundaries hotkey Fires when applying a hotkey indent-task Fires when
indenting a task move-task Fires when moving a task open-task Fires when expanding a branch of tasks
provide-data Provides new data for a branch render-data Fires when data is rendered when scrolling
request-data Fires when data for a task branch is requested scroll-chart Fires when a chart is
scrolled select-task Fires when selecting a task show-editor Fires when opening the Editor dialog
for a task sort-tasks Fires when sorting tasks update-link Fires when updating a link update-task
Fires when updating a task zoom-scale Fires when zooming a chart

### Gantt methods

api.detach() Allows removing/detaching action handlers api.exec() Allows triggering Gantt actions
api.getReactiveState() Gets the state object with the reactive properties of Gantt api.getState()
Gets the state object that stores current values of most Gantt properties api.getStores() Gets an
object with the DataStore properties of Gantt api.getTask(id) Gets an object with the task
configuration api.intercept() Allows intercepting and blocking/modifying actions api.on() Allows
attaching a handler to the inner events api.setNext() Allows adding some action into the Event Bus
order

### How to access Gantt API

https://docs.svar.dev/svelte/gantt/api/how_to_access_api

### API Methods

https://docs.svar.dev/svelte/gantt/api/overview/methods_overview

### API Properties

https://docs.svar.dev/svelte/gantt/api/overview/properties_overview

### API Actions

https://docs.svar.dev/svelte/gantt/api/overview/actions_overview

## Helpers

https://docs.svar.dev/svelte/gantt/category/helpers

🗃️ RestDataProvider 2 items

📄️ ContextMenu ContextMenu helper

📄️ Editor Editor helper

📄️ Fullscreen Fullscreen helper

📄️ HeadertMenu HeaderMenu helper

📄️ Toolbar Toolbar helper

📄️ Tooltip Tooltip helper

📄️ defaultColumns An array of objects with default configuration parameters for the Gantt columns
in the grid area

📄️ defaultEditorItems An array of objects with the default configuration for the Editor component

📄️ defaultMenuOptions An array of objects with default configuration parameters for context menu
items

📄️ defaultTaskTypes An array of default task types

📄️ defaultToolbarButtons An array of objects with default configuration parameters for the Toolbar
buttons

📄️ registerEditorItem Registers a custom UI component for use as a field in the Editor

📄️ registerScaleUnit Allows adding a custom scale unit

## Gantt Examples

- Basic Gantt
  - https://docs.svar.dev/svelte/gantt/samples/#/base/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/BasicInit.svelte

- Scale / cell sizes
  - https://docs.svar.dev/svelte/gantt/samples/#/sizes/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttSizes.svelte
- Chart cell borders
  - https://docs.svar.dev/svelte/gantt/samples/#/cell-borders/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/ChartCellBorders.svelte

- Custom scales
  - https://docs.svar.dev/svelte/gantt/samples/#/scales/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttScales.svelte
- Start/end dates
  - https://docs.svar.dev/svelte/gantt/samples/#/start-end/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttStartEnd.svelte
- Custom scale unit
  - https://docs.svar.dev/svelte/gantt/samples/#/custom-scale/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttScaleUnit.svelte
- Custom minimal scale unit
  - https://docs.svar.dev/svelte/gantt/samples/#/custom-min-scale/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttMinScaleUnit.svelte
- Markers
  - https://docs.svar.dev/svelte/gantt/samples/#/markers/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttMarkers.svelte
- Unscheduled tasks
  - https://docs.svar.dev/svelte/gantt/samples/#/unscheduled-tasks/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/UnscheduledTasks.svelte
- Unscheduled tasks and Baselines
  - https://docs.svar.dev/svelte/gantt/samples/#/unscheduled-tasks-and-baseline/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/UnscheduledTasksAndBaselines.svelte
- Baselines
  - https://docs.svar.dev/svelte/gantt/samples/#/baseline/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttBaseline.svelte
- Holidays
  - https://docs.svar.dev/svelte/gantt/samples/#/holidays/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttHolidays.svelte

- Custom text
  - https://docs.svar.dev/svelte/gantt/samples/#/templates/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttText.svelte
- Tooltips
  - https://docs.svar.dev/svelte/gantt/samples/#/tooltips/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttTooltips.svelte
- Task types
  - https://docs.svar.dev/svelte/gantt/samples/#/task-types/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttTaskTypes.svelte
- Summary tasks with auto progress
  - https://docs.svar.dev/svelte/gantt/samples/#/summary-progress/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttSummariesProgress.svelte
- No drag for summary tasks
  - https://docs.svar.dev/svelte/gantt/samples/#/summary-no-drag/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttSummariesNoDrag.svelte
- Auto convert to summary tasks
  - https://docs.svar.dev/svelte/gantt/samples/#/summary-convert/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttSummariesConvert.svelte
- Zoom
  - https://docs.svar.dev/svelte/gantt/samples/#/zoom/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttZoom.svelte
- Custom Zoom
  - https://docs.svar.dev/svelte/gantt/samples/#/custom-zoom/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttCustomZoom.svelte
- Length unit (rounding)
  - https://docs.svar.dev/svelte/gantt/samples/#/length-unit/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttLengthUnit.svelte
- Duration unit: hour
  - https://docs.svar.dev/svelte/gantt/samples/#/duration-unit/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttDurationUnitHour.svelte
- Duration unit: changes
  - https://docs.svar.dev/svelte/gantt/samples/#/duration-changes/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttDurationUnitChanges.svelte
- No grid
  - https://docs.svar.dev/svelte/gantt/samples/#/no-grid/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttNoGrid.svelte
- Flexible grid columns
  - https://docs.svar.dev/svelte/gantt/samples/#/grid-fill-space-columns/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttFlexColumns.svelte
- Fixed grid columns
  - https://docs.svar.dev/svelte/gantt/samples/#/grid-fixed-columns/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttFixedColumns.svelte
- Custom grid columns
  - https://docs.svar.dev/svelte/gantt/samples/#/grid-custom-columns/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttGrid.svelte

- Grid inline editors
  - https://docs.svar.dev/svelte/gantt/samples/#/grid-inline-editors/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GridInlineEditors.svelte
- Toolbar
  - https://docs.svar.dev/svelte/gantt/samples/#/toolbar/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttToolbar.svelte

- Toolbar: limited buttons
  - https://docs.svar.dev/svelte/gantt/samples/#/toolbar-buttons/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttToolbarButtons.svelte
- Toolbar: custom buttons
  - https://docs.svar.dev/svelte/gantt/samples/#/toolbar-custom/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttToolbarCustom.svelte
- Context menu
  - https://docs.svar.dev/svelte/gantt/samples/#/context-menu/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/ContextMenu.svelte
- Context menu: limiting options
  - https://docs.svar.dev/svelte/gantt/samples/#/menu-handler/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/ContextMenuHandler.svelte
- Context menu: custom options
  - https://docs.svar.dev/svelte/gantt/samples/#/menu-options/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/ContextMenuOptions.svelte
- Header menu: hiding columns
  - https://docs.svar.dev/svelte/gantt/samples/#/header-menu/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/HeaderMenu.svelte
- Custom editor
  - https://docs.svar.dev/svelte/gantt/samples/#/custom-edit-form/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttForm.svelte
- Locales
  - https://docs.svar.dev/svelte/gantt/samples/#/locale/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttLocale.svelte
- Fullscreen
  - https://docs.svar.dev/svelte/gantt/samples/#/fullscreen/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttFullscreen.svelte
- Readonly mode
  - https://docs.svar.dev/svelte/gantt/samples/#/readonly/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttReadOnly.svelte
- Preventing actions
  - https://docs.svar.dev/svelte/gantt/samples/#/prevent-actions/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttPreventActions.svelte
- Many Gantts per page
  - https://docs.svar.dev/svelte/gantt/samples/#/gantt-multiple/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttMultiple.svelte
- Performance optimisation
  - https://docs.svar.dev/svelte/gantt/samples/#/performance/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttPerformance.svelte
- Custom sorting
  - https://docs.svar.dev/svelte/gantt/samples/#/sorting/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttSort.svelte
- Sort by API
  - https://docs.svar.dev/svelte/gantt/samples/#/sorting-api/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttCustomSort.svelte
- Backend data
  - https://docs.svar.dev/svelte/gantt/samples/#/backend/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttBackend.svelte
- Saving to backend
  - https://docs.svar.dev/svelte/gantt/samples/#/backend-provider/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttProvider.svelte
- Saving to backend (batch)
  - https://docs.svar.dev/svelte/gantt/samples/#/backend-provider-batch/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttBatchProvider.svelte
- Editor
  - https://docs.svar.dev/svelte/gantt/samples/#/editor/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttEditor.svelte
- Editor: custom settings
  - https://docs.svar.dev/svelte/gantt/samples/#/editor-config/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttEditorConfig.svelte
- Editor: custom controls
  - https://docs.svar.dev/svelte/gantt/samples/#/editor-custom-controls/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttEditorCustomControls.svelte
- Editor: custom comments
  - https://docs.svar.dev/svelte/gantt/samples/#/editor-comments/willow
  - code:
    https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttEditorComments.svelte
- Editor: custom tasks
  - https://docs.svar.dev/svelte/gantt/samples/#/editor-tasks/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/GanttEditorTasks.svelte
- Editor: readonly
  - https://docs.svar.dev/svelte/gantt/samples/#/editor-readonly/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/.svelte
- Editor: validation
  - https://docs.svar.dev/svelte/gantt/samples/#/editor-validation/willow
  - code: https://github.com/svar-widgets/gantt/tree/main/svelte/demos/cases/.svelte
