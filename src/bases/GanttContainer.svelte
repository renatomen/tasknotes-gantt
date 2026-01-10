<script lang="ts">
  /* global HTMLElement, setTimeout, getComputedStyle */
  import { Gantt, Willow } from '@svar-ui/svelte-gantt';
  import { Toolbar } from '@svar-ui/svelte-toolbar';
  import { setIcon } from 'obsidian';
  import type { BasesQueryResult } from './register';
  import type { FieldMappings } from './types/field-mapping';
  import { PropertyMappingService } from './services/PropertyMappingService';

  // Component props
  interface Props {
    data?: BasesQueryResult;
    fieldMappings?: FieldMappings;
    app: import('obsidian').App;
    config?: import('./register').BasesViewConfig;
  }

  let { data, fieldMappings, app, config }: Props = $props();

  // Column configuration for SVAR Gantt grid
  // Following SVAR format: https://docs.svar.dev/svelte/gantt/guides/configuration/configure_grid/
  // Columns match Bases visible properties in order, using Bases display names
  const columns = $derived.by(() => {
    if (!fieldMappings || !data) {
      return [];
    }

    const visibleProperties = data.properties || [];
    console.log('[GanttContainer] Visible properties from Bases:', visibleProperties);
    console.log('[GanttContainer] Field mappings:', fieldMappings);

    // If no properties selected in Bases, show no columns
    if (visibleProperties.length === 0) {
      console.log('[GanttContainer] No properties selected - showing no columns');
      return [];
    }

    const cols = [];

    // Create a mapping from property IDs to SVAR column IDs
    const propertyToSvarColumn = new Map<string, string>();

    // Determine which property should be the text column
    // If textProperty is empty string, use file.basename (following BasesDataAdapter pattern)
    const textPropertyId = fieldMappings.textProperty || 'file.basename';

    // Map configured properties to SVAR column IDs
    propertyToSvarColumn.set(textPropertyId, 'text');
    if (fieldMappings.startProperty) {
      propertyToSvarColumn.set(fieldMappings.startProperty, 'start');
    }
    if (fieldMappings.endProperty) {
      propertyToSvarColumn.set(fieldMappings.endProperty, 'end');
    }
    if (fieldMappings.progressProperty) {
      propertyToSvarColumn.set(fieldMappings.progressProperty, 'progress');
    }
    // Parent property is not shown as a column

    // IMPORTANT: SVAR Gantt requires the 'text' column to be FIRST for hierarchy visualization
    // to work (indentation and expand/collapse chevrons). If the text property is in visible
    // properties, we add it first, then add all other properties in their Bases order.

    // Step 1: Check if text property is in visible properties and add it first
    const hasTextProperty = visibleProperties.includes(textPropertyId);

    if (hasTextProperty) {
      const displayName = config?.getDisplayName?.(textPropertyId) || textPropertyId;
      cols.push({
        id: 'text',
        header: displayName,
        width: 300, // Fixed width without flexgrow - SVAR may have issues when both are set
        align: 'left',
      });
      console.log('[GanttContainer] Added text column as first column for hierarchy support:', textPropertyId);
    } else {
      console.warn('[GanttContainer] Text property not in visible properties:', textPropertyId);
    }

    // Step 2: Process all other visible properties IN ORDER from Bases (excluding text)
    for (const propertyId of visibleProperties) {
      // Skip parent property - not shown as column
      if (propertyId === fieldMappings.parentProperty) {
        continue;
      }

      // Skip text property - already added as first column
      if (propertyId === textPropertyId) {
        continue;
      }

      // Get display name from Bases config
      const displayName = config?.getDisplayName?.(propertyId) || propertyId;

      // Determine SVAR column ID (use mapped ID if available, otherwise use property ID)
      const svarColumnId = propertyToSvarColumn.get(propertyId) || propertyId;

      // Determine column width and alignment
      let width = 120;
      let align: 'left' | 'center' | 'right' = 'left';
      let flexgrow: number | undefined = undefined;

      // Special handling for SVAR built-in columns
      if (svarColumnId === 'start' || svarColumnId === 'end') {
        align = 'center';
      } else if (svarColumnId === 'progress') {
        width = 100;
        align = 'center';
      }

      const col: any = {
        id: svarColumnId,
        header: displayName
      };

      if (flexgrow !== undefined) {
        col.flexgrow = flexgrow;
      } else if (width !== undefined) {
        col.width = width;
      }

      if (align) {
        col.align = align;
      }

      cols.push(col);
    }

    console.log('[GanttContainer] Columns to display:', cols);

    return cols;
  });

  // Svelte action to set Obsidian/Lucide icons (OG-81)
  function lucideIcon(node: HTMLElement, iconName: string) {
    setIcon(node, iconName);
    return {
      update(newIconName: string) {
        node.empty();
        setIcon(node, newIconName);
      }
    };
  }

  // Type definitions for task editing
  interface GanttTask {
    id: string;
    text: string;
    start: string;
    end: string;
    progress: number;
  }

  // SVAR Gantt API - using unknown with type assertions for third-party API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GanttAPI = any;

  // Note: SVAR Gantt may generate console warnings:
  // - Non-passive event listeners for touch/wheel (required for drag functionality)
  // - Performance violations during chart rendering (expected for complex UI)
  // CSP violations for external fonts are prevented by fonts={false} and custom icon implementation

  let api: GanttAPI = $state();
  let editingTask: GanttTask | null = $state(null);
  let showEditor = $state(false);

  // Transform Bases data to SVAR tasks using PropertyMappingService
  const transformedData = $derived.by(() => {
    console.log('[GanttContainer] === TRANSFORM START ===');
    console.log('[GanttContainer] data:', data);
    console.log('[GanttContainer] fieldMappings:', fieldMappings);
    console.log('[GanttContainer] hasData:', !!data);
    console.log('[GanttContainer] hasFieldMappings:', !!fieldMappings);
    console.log('[GanttContainer] entriesCount:', data?.data?.length || 0);

    if (!data || !fieldMappings) {
      console.log('[GanttContainer] ❌ No data or mappings, returning empty');
      return { tasks: [], errors: [] };
    }

    const service = new PropertyMappingService(app);
    const visibleProperties = data.properties || [];
    const result = service.transformEntries(data.data, fieldMappings, visibleProperties);

    console.log('[GanttContainer] ✅ Transformed result:');
    console.log('[GanttContainer]   - taskCount:', result.tasks.length);
    console.log('[GanttContainer]   - errorCount:', result.errors.length);
    console.log('[GanttContainer]   - first task:', result.tasks[0]);
    console.log('[GanttContainer]   - all tasks:', result.tasks);
    console.log('[GanttContainer]   - errors:', result.errors);
    console.log('[GanttContainer] === TRANSFORM END ===');

    return result;
  });

  // Use transformed tasks or fallback to dummy data
  const tasks = $derived.by(() => {
    let realTasks = transformedData.tasks;
    const useDummy = realTasks.length === 0;

    console.log('[GanttContainer] === TASKS SELECTION ===');
    console.log('[GanttContainer] realTasks.length:', realTasks.length);
    console.log('[GanttContainer] useDummy:', useDummy);
    console.log('[GanttContainer] returning:', useDummy ? 'DUMMY DATA' : 'REAL DATA');
    if (!useDummy && realTasks.length > 0) {
      const firstTask = realTasks[0]!;
      console.log('[GanttContainer] first real task:', firstTask);
      console.log('[GanttContainer] first task keys:', Object.keys(firstTask));
      console.log('[GanttContainer] first task stringified:', JSON.stringify(firstTask, (key, value) => {
        // Convert dates to ISO strings for logging
        if (value instanceof Date) return value.toISOString();
        return value;
      }, 2));

      // Log date range for debugging
      const dates = realTasks.map(t => [t.start, t.end]).flat().filter(d => d instanceof Date);
      if (dates.length > 0) {
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
        console.log('[GanttContainer] Date range:', minDate.toISOString(), 'to', maxDate.toISOString());
      }

      // Check for tasks with/without parent
      const rootTasks = realTasks.filter(t => !t.parent);
      const childTasks = realTasks.filter(t => t.parent);
      console.log('[GanttContainer] Root tasks (no parent):', rootTasks.length);
      console.log('[GanttContainer] Child tasks (with parent):', childTasks.length);

      // Validate parent references
      const allTaskIds = new Set(realTasks.map(t => t.id));
      const invalidParents = childTasks.filter(t => t.parent && !allTaskIds.has(String(t.parent)));
      if (invalidParents.length > 0) {
        console.warn('[GanttContainer] ⚠️ Tasks with invalid parent references:', invalidParents.length);
        console.warn('[GanttContainer] First invalid parent:', invalidParents[0]);
        console.warn('[GanttContainer] Parent ID:', invalidParents[0]?.parent);
        console.warn('[GanttContainer] All task IDs sample (first 5):', Array.from(allTaskIds).slice(0, 5));
      }

      // Check if parent tasks exist for each child
      const orphanedTasks = childTasks.filter(t => {
        if (!t.parent) return false;
        const parentExists = allTaskIds.has(String(t.parent));
        if (!parentExists) {
          console.warn('[GanttContainer] Orphaned task:', t.id, 'looking for parent:', t.parent);
        }
        return !parentExists;
      });
      if (orphanedTasks.length > 0) {
        console.warn('[GanttContainer] ⚠️ Orphaned tasks (parent not found):', orphanedTasks.length);
        console.warn('[GanttContainer] Removing invalid parent references from orphaned tasks...');
      }

      // Fix orphaned tasks by removing their invalid parent references
      const orphanedTaskIds = new Set(orphanedTasks.map(t => t.id));
      realTasks = realTasks.map(task => {
        if (orphanedTaskIds.has(task.id)) {
          // Remove invalid parent reference - make this a root task
          // eslint-disable-next-line no-unused-vars
          const { parent: _parent, ...taskWithoutParent } = task;
          console.log('[GanttContainer] Removed parent from:', task.id);
          return taskWithoutParent;
        }
        return task;
      });

      // Mark parent tasks with 'open: true' (SVAR requires this for hierarchical tasks)
      // Re-calculate child tasks after fixing orphaned ones
      const validChildTasks = realTasks.filter(t => t.parent && allTaskIds.has(String(t.parent)));
      const parentTaskIds = new Set(validChildTasks.map(t => String(t.parent)).filter(p => p));
      realTasks = realTasks.map(task => {
        if (parentTaskIds.has(task.id)) {
          // This task has children - mark as summary and open
          return {
            ...task,
            type: 'summary',
            open: true
          };
        }
        return task;
      });
      console.log('[GanttContainer] Marked parent tasks as summary:', parentTaskIds.size);
    }

    return useDummy ? getDummyTasks() : realTasks;
  });

  // Custom toolbar items using Obsidian-style actions
  const toolbarItems = [
    {
      comp: "button",
      text: "Add Task",
      handler: () => {
        if (api) {
          api.exec("add-task", {
            task: { text: "New task" },
            target: null,
            mode: "after"
          });
        }
      }
    },
    {
      comp: "button",
      text: "Zoom In",
      handler: () => {
        if (api) {
          api.exec("zoom-scale", { dir: "in" });
        }
      }
    },
    {
      comp: "button",
      text: "Zoom Out",
      handler: () => {
        if (api) {
          api.exec("zoom-scale", { dir: "out" });
        }
      }
    }
  ];

  // Initialize API and intercept editor events
  function initGantt(ganttApi: GanttAPI) {
    api = ganttApi;

    // Log the state SVAR received
    console.log('[GanttContainer] SVAR Gantt initialized');
    if (api && api.getState) {
      const state = api.getState();
      console.log('[GanttContainer] SVAR state:', state);
      console.log('[GanttContainer] SVAR tasks count:', state?.tasks?.length || 0);
      if (state?.tasks && state.tasks.length > 0) {
        console.log('[GanttContainer] First SVAR task:', state.tasks[0]);
      }
    }

    // Intercept the show-editor event to use our custom editor
    api.intercept("show-editor", ({ id }: { id: string }) => {
      if (id) {
        editingTask = api?.getState().tasks.byId(id);
        showEditor = true;
      }
      return false; // Prevent default editor
    });

    // Fix initial scroll position - ensure the grid starts with first column visible
    // SVAR Gantt sometimes initializes with horizontal scroll that hides the first column
    setTimeout(() => {
      try {
        console.log('[GanttContainer] Attempting to reset grid scroll position...');

        // Try multiple possible selectors for the scrollable grid container
        const selectors = [
          '.og-bases-gantt .wx-grid',
          '.og-bases-gantt .wx-grid-area',
          '.og-bases-gantt .wx-grid-data',
          '.og-bases-gantt .wx-layout-grid',
          '.og-bases-gantt .wx-grid-body',
          '.og-bases-gantt [data-id="grid"]',
        ];

        let foundScrollable = false;
        for (const selector of selectors) {
          const element = document.querySelector(selector) as HTMLElement;
          if (element) {
            console.log(`[GanttContainer] Found element with selector "${selector}"`, {
              scrollLeft: element.scrollLeft,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              overflowX: getComputedStyle(element).overflowX,
            });

            // Reset scroll if this element has scrollLeft > 0
            if (element.scrollLeft > 0) {
              console.log(`[GanttContainer] Resetting scrollLeft from ${element.scrollLeft} to 0`);
              element.scrollLeft = 0;
              foundScrollable = true;
            }
          }
        }

        if (!foundScrollable) {
          console.warn('[GanttContainer] Could not find grid element with scroll to reset');
          // Log all elements with wx- classes for debugging
          const wxElements = document.querySelectorAll('[class*="wx-"]');
          console.log('[GanttContainer] Found elements with wx- classes:', Array.from(wxElements).map(el => el.className));
        } else {
          console.log('[GanttContainer] Successfully reset grid scroll position');
        }
      } catch (error) {
        console.error('[GanttContainer] Error resetting grid scroll:', error);
      }
    }, 200); // Increased delay to ensure DOM is fully ready
  }

  // Handle custom editor actions
  function handleEditorAction(action: string, data: GanttTask | null) {
    switch (action) {
      case "close-editor":
        showEditor = false;
        editingTask = null;
        break;
      case "update-task":
        if (api && editingTask) {
          api.exec("update-task", { id: editingTask.id, task: data });
          showEditor = false;
          editingTask = null;
        }
        break;
      case "delete-task":
        if (api && editingTask) {
          api.exec("delete-task", { id: editingTask.id });
          showEditor = false;
          editingTask = null;
        }
        break;
    }
  }

  // Dummy data for OG-23 basic Gantt rendering - following SVAR BasicInit pattern
  // Expanded dataset to test scroll behavior with sufficient rows
  function getDummyTasks() {
    return [
    {
      id: 1,
      start: new Date(2025, 0, 2),
      end: new Date(2025, 0, 17),
      text: "Project Planning",
      progress: 30,
      parent: 0,
      type: "summary",
      open: true,
    },
    {
      id: 10,
      start: new Date(2025, 0, 2),
      end: new Date(2025, 0, 5),
      text: "Requirements gathering",
      progress: 100,
      parent: 1,
      type: "task",
    },
    {
      id: 11,
      start: new Date(2025, 0, 5),
      end: new Date(2025, 0, 9),
      text: "Architecture design",
      progress: 80,
      parent: 1,
      type: "task",
    },
    {
      id: 12,
      start: new Date(2025, 0, 9),
      end: new Date(2025, 0, 12),
      text: "UI/UX mockups",
      progress: 60,
      parent: 1,
      type: "task",
    },
    {
      id: 13,
      start: new Date(2025, 0, 12),
      end: new Date(2025, 0, 17),
      text: "Technical documentation",
      progress: 40,
      parent: 1,
      type: "task",
    },
    {
      id: 2,
      start: new Date(2025, 0, 17),
      end: new Date(2025, 1, 14),
      text: "Backend Development",
      progress: 50,
      parent: 0,
      type: "summary",
      open: true,
    },
    {
      id: 20,
      start: new Date(2025, 0, 17),
      end: new Date(2025, 0, 24),
      text: "Database schema setup",
      progress: 100,
      parent: 2,
      type: "task",
    },
    {
      id: 21,
      start: new Date(2025, 0, 24),
      end: new Date(2025, 0, 31),
      text: "API endpoints development",
      progress: 75,
      parent: 2,
      type: "task",
    },
    {
      id: 22,
      start: new Date(2025, 0, 31),
      end: new Date(2025, 1, 7),
      text: "Authentication module",
      progress: 50,
      parent: 2,
      type: "task",
    },
    {
      id: 23,
      start: new Date(2025, 1, 7),
      end: new Date(2025, 1, 14),
      text: "Data validation layer",
      progress: 25,
      parent: 2,
      type: "task",
    },
    {
      id: 3,
      start: new Date(2025, 1, 14),
      end: new Date(2025, 2, 7),
      text: "Frontend Development",
      progress: 35,
      parent: 0,
      type: "summary",
      open: true,
    },
    {
      id: 30,
      start: new Date(2025, 1, 14),
      end: new Date(2025, 1, 21),
      text: "Component library setup",
      progress: 90,
      parent: 3,
      type: "task",
    },
    {
      id: 31,
      start: new Date(2025, 1, 21),
      end: new Date(2025, 1, 28),
      text: "Dashboard implementation",
      progress: 60,
      parent: 3,
      type: "task",
    },
    {
      id: 32,
      start: new Date(2025, 1, 28),
      end: new Date(2025, 2, 7),
      text: "User profile pages",
      progress: 30,
      parent: 3,
      type: "task",
    },
    {
      id: 4,
      start: new Date(2025, 2, 7),
      end: new Date(2025, 2, 28),
      text: "Testing & QA",
      progress: 20,
      parent: 0,
      type: "summary",
      open: true,
    },
    {
      id: 40,
      start: new Date(2025, 2, 7),
      end: new Date(2025, 2, 14),
      text: "Unit testing",
      progress: 40,
      parent: 4,
      type: "task",
    },
    {
      id: 41,
      start: new Date(2025, 2, 14),
      end: new Date(2025, 2, 21),
      text: "Integration testing",
      progress: 15,
      parent: 4,
      type: "task",
    },
    {
      id: 42,
      start: new Date(2025, 2, 21),
      end: new Date(2025, 2, 28),
      text: "E2E testing",
      progress: 10,
      parent: 4,
      type: "task",
    },
    {
      id: 5,
      start: new Date(2025, 2, 28),
      end: new Date(2025, 3, 11),
      text: "Deployment",
      progress: 5,
      parent: 0,
      type: "summary",
      open: true,
    },
    {
      id: 50,
      start: new Date(2025, 2, 28),
      end: new Date(2025, 3, 4),
      text: "Staging environment setup",
      progress: 20,
      parent: 5,
      type: "task",
    },
    {
      id: 51,
      start: new Date(2025, 3, 4),
      end: new Date(2025, 3, 8),
      text: "Production deployment",
      progress: 0,
      parent: 5,
      type: "task",
    },
    {
      id: 52,
      start: new Date(2025, 3, 8),
      end: new Date(2025, 3, 11),
      text: "Monitoring & rollback plan",
      progress: 0,
      parent: 5,
      type: "task",
    },
  ];
  }

  const links = [
    // Planning phase
    { id: 1, source: 10, target: 11, type: "e2s" },
    { id: 2, source: 11, target: 12, type: "e2s" },
    { id: 3, source: 12, target: 13, type: "e2s" },
    // Backend phase
    { id: 4, source: 20, target: 21, type: "e2s" },
    { id: 5, source: 21, target: 22, type: "e2s" },
    { id: 6, source: 22, target: 23, type: "e2s" },
    // Frontend phase
    { id: 7, source: 30, target: 31, type: "e2s" },
    { id: 8, source: 31, target: 32, type: "e2s" },
    // Testing phase
    { id: 9, source: 40, target: 41, type: "e2s" },
    { id: 10, source: 41, target: 42, type: "e2s" },
    // Deployment phase
    { id: 11, source: 50, target: 51, type: "e2s" },
    { id: 12, source: 51, target: 52, type: "e2s" },
    // Cross-phase dependencies
    { id: 13, source: 13, target: 20, type: "e2s" },
    { id: 14, source: 23, target: 30, type: "e2s" },
    { id: 15, source: 32, target: 40, type: "e2s" },
    { id: 16, source: 42, target: 50, type: "e2s" },
  ];

  // Zoom configuration with defined levels for proper zoom-scale action (OG-81)
  // Each level defines the scales to display at that zoom level
  const zoomConfig = {
    level: 3, // Start at month/day level
    minCellWidth: 40,
    maxCellWidth: 300,
    levels: [
      // Level 0: Year overview
      {
        minCellWidth: 100,
        maxCellWidth: 300,
        scales: [{ unit: "year", step: 1, format: "yyyy" }],
      },
      // Level 1: Year + Quarter
      {
        minCellWidth: 80,
        maxCellWidth: 200,
        scales: [
          { unit: "year", step: 1, format: "yyyy" },
          { unit: "quarter", step: 1, format: "QQQ" },
        ],
      },
      // Level 2: Quarter + Month
      {
        minCellWidth: 60,
        maxCellWidth: 150,
        scales: [
          { unit: "quarter", step: 1, format: "QQQ yyyy" },
          { unit: "month", step: 1, format: "MMM" },
        ],
      },
      // Level 3: Month + Week (default)
      {
        minCellWidth: 50,
        maxCellWidth: 120,
        scales: [
          { unit: "month", step: 1, format: "MMMM yyyy" },
          { unit: "week", step: 1, format: "'W'w" },
        ],
      },
      // Level 4: Month + Day
      {
        minCellWidth: 30,
        maxCellWidth: 80,
        scales: [
          { unit: "month", step: 1, format: "MMMM yyyy" },
          { unit: "day", step: 1, format: "d" },
        ],
      },
      // Level 5: Week + Day (detailed)
      {
        minCellWidth: 25,
        maxCellWidth: 60,
        scales: [
          { unit: "week", step: 1, format: "'Week' w, MMM yyyy" },
          { unit: "day", step: 1, format: "EEE d" },
        ],
      },
    ],
  };
</script>

<div class="og-bases-gantt">
  <Willow fonts={false}>
    <Toolbar items={toolbarItems} />
    <div class="gtcell">
      <Gantt
        init={initGantt}
        {tasks}
        {links}
        {columns}
        zoom={zoomConfig}
      />

      <!-- Floating Zoom Controls (OG-81) -->
      <div class="zoom-controls">
        <button
          class="zoom-btn zoom-in"
          onclick={() => api?.exec("zoom-scale", { dir: 1, date: new Date() })}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <span class="zoom-icon" use:lucideIcon={'plus'}></span>
        </button>
        <button
          class="zoom-btn zoom-out"
          onclick={() => api?.exec("zoom-scale", { dir: -1, date: new Date() })}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <span class="zoom-icon" use:lucideIcon={'minus'}></span>
        </button>
      </div>
    </div>

    <!-- Custom Editor Modal -->
    {#if showEditor && editingTask}
      <div class="editor-overlay">
        <div class="editor-modal">
          <div class="editor-header">
            <h3>Edit Task</h3>
            <button class="close-btn" onclick={() => handleEditorAction("close-editor", null)}>×</button>
          </div>
          <div class="editor-content">
            <div class="form-group">
              <label for="task-name">Task Name:</label>
              <input
                id="task-name"
                type="text"
                bind:value={editingTask.text}
                class="form-input"
              />
            </div>
            <div class="form-group">
              <label for="task-progress">Progress:</label>
              <input
                id="task-progress"
                type="range"
                min="0"
                max="100"
                bind:value={editingTask.progress}
                class="form-range"
              />
              <span>{editingTask.progress}%</span>
            </div>
            <div class="form-group">
              <label for="task-start">Start Date:</label>
              <input
                id="task-start"
                type="date"
                bind:value={editingTask.start}
                class="form-input"
              />
            </div>
            <div class="form-group">
              <label for="task-end">End Date:</label>
              <input
                id="task-end"
                type="date"
                bind:value={editingTask.end}
                class="form-input"
              />
            </div>
          </div>
          <div class="editor-actions">
            <button class="btn btn-primary" onclick={() => handleEditorAction("update-task", editingTask)}>
              Save
            </button>
            <button class="btn btn-danger" onclick={() => handleEditorAction("delete-task", null)}>
              Delete
            </button>
            <button class="btn btn-secondary" onclick={() => handleEditorAction("close-editor", null)}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    {/if}
  </Willow>
</div>

<style>
  .og-bases-gantt {
    height: 400px;
    width: 100%;
    min-height: 400px;
    /* Use Obsidian's font stack since we disabled SVAR fonts */
    font-family: var(--font-interface), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .gtcell {
    height: calc(100% - 50px);
    border-top: var(--wx-gantt-border);
    /* Position relative for floating zoom controls (OG-81) */
    position: relative;
  }

  /* OG-79: Touch device scroll fix for drag-and-drop */
  /* Chart container: allow normal scroll/pan on empty timeline space */
  .og-bases-gantt :global(.wx-chart) {
    touch-action: auto;
  }

  /* Bars: block browser gestures, let SVAR handle drag/resize */
  .og-bases-gantt :global(.wx-bar) {
    touch-action: none;
  }

  /* Floating Zoom Controls - Google Maps style (OG-81) */
  .zoom-controls {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    z-index: 100;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .zoom-btn {
    /* Force consistent square shape across all devices */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    max-width: 40px;
    max-height: 40px;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 0;
    background-color: #ffffff;
    color: #5f6368;
    cursor: pointer;
    /* Remove all default styling that might cause circles */
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    box-sizing: border-box;
  }

  /* Only style change on click/active - no hover effects for mobile consistency */
  .zoom-btn:active {
    background-color: #e0e0e0;
  }

  /* Container for Lucide icon (OG-81) */
  .zoom-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    pointer-events: none;
  }

  /* Style the Lucide SVG injected by Obsidian's setIcon (OG-81) */
  .zoom-icon :global(svg) {
    width: 18px;
    height: 18px;
    stroke: #5f6368;
    fill: none;
    stroke-width: 2;
  }

  .zoom-in {
    border-bottom: 1px solid #dadce0;
  }

  /* OG-79: Touch device scroll fix for drag-and-drop */
  /* Chart container: allow normal scroll/pan on empty timeline space */
  .og-bases-gantt :global(.wx-chart) {
    touch-action: auto;
  }

  /* Bars: block browser gestures, let SVAR handle drag/resize */
  .og-bases-gantt :global(.wx-bar) {
    touch-action: none;
  }

  /* Custom Editor Styles */
  .editor-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .editor-modal {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    width: 400px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .editor-header h3 {
    margin: 0;
    color: var(--text-normal);
    font-size: 16px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: var(--text-normal);
  }

  .editor-content {
    padding: 20px;
  }

  .form-group {
    margin-bottom: 16px;
  }

  .form-group label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-normal);
    font-size: 14px;
    font-weight: 500;
  }

  .form-input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 14px;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .form-range {
    width: calc(100% - 50px);
    margin-right: 10px;
  }

  .editor-actions {
    padding: 16px 20px;
    border-top: 1px solid var(--background-modifier-border);
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .btn-primary:hover {
    background: var(--interactive-accent-hover);
  }

  .btn-danger {
    background: #e74c3c;
    color: white;
  }

  .btn-danger:hover {
    background: #c0392b;
  }

  .btn-secondary {
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
  }

  .btn-secondary:hover {
    background: var(--background-secondary-alt);
  }

  /* Replace SVAR icons with Lucide-style SVG icons */
  .og-bases-gantt :global(.wx-icon) {
    display: inline-block;
    width: 16px;
    height: 16px;
    vertical-align: middle;
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  /* Common toolbar icons using CSS-based SVG */
  .og-bases-gantt :global(.wx-icon.wxi-plus)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12h14'/%3E%3Cpath d='m12 5 0 14'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-edit)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/%3E%3Cpath d='m15 5 4 4'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-delete)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 6h18'/%3E%3Cpath d='M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'/%3E%3Cpath d='M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-zoom-in)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3Cpath d='M11 8v6'/%3E%3Cpath d='M8 11h6'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-zoom-out)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3Cpath d='M8 11h6'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-fullscreen)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7V5a2 2 0 0 1 2-2h2'/%3E%3Cpath d='M17 3h2a2 2 0 0 1 2 2v2'/%3E%3Cpath d='M21 17v2a2 2 0 0 1-2 2h-2'/%3E%3Cpath d='M7 21H5a2 2 0 0 1-2-2v-2'/%3E%3C/svg%3E");
  }

  /* OG-82: Grid collapse/expand arrow icons for SVAR Resizer */
  /* These icons are used by SVAR's built-in Resizer component for panel toggle */
  .og-bases-gantt :global(.wxi-menu-left) {
    display: inline-block;
    width: 20px;
    height: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%235f6368' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  .og-bases-gantt :global(.wxi-menu-left:hover) {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wxi-menu-right) {
    display: inline-block;
    width: 20px;
    height: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%235f6368' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  .og-bases-gantt :global(.wxi-menu-right:hover) {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
  }

  /* OG-82: Hide the decorative spike/arrow pseudo-elements from SVAR Resizer */
  .og-bases-gantt :global(.wx-button-expand-content::before),
  .og-bases-gantt :global(.wx-button-expand-content::after) {
    display: none !important;
  }

  /* OG-87: Unscheduled tasks styling (red bars) */
  .og-bases-gantt :global(.wx-bar[data-unscheduled="true"]) {
    background-color: #e74c3c !important;
    border-color: #c0392b !important;
  }

  .og-bases-gantt :global(.wx-bar[data-unscheduled="true"] .wx-bar-label) {
    color: white !important;
  }

  .og-bases-gantt :global(.wx-bar[data-unscheduled="true"] .wx-bar-progress) {
    background-color: #c0392b !important;
  }

  /* SVAR expand/collapse toggle icons - ensure visibility */
  .og-bases-gantt :global(.wx-toggle-icon) {
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    color: var(--text-muted) !important;
    opacity: 1 !important;
    visibility: visible !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }

  .og-bases-gantt :global(.wx-toggle-icon:hover) {
    color: var(--text-normal) !important;
  }

  /* Ensure SVAR icon fonts are loaded and visible */
  .og-bases-gantt :global(.wx-toggle-icon::before) {
    opacity: 1 !important;
    visibility: visible !important;
    display: inline-block !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }

  /* Inject offline-friendly Lucide chevron icons using inline SVG */
  .og-bases-gantt :global(.wxi-menu-down),
  .og-bases-gantt :global(.wxi-menu-right) {
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    opacity: 1 !important;
    visibility: visible !important;
  }

  /* Lucide chevron-down icon as inline SVG data URI */
  .og-bases-gantt :global(.wxi-menu-down::before) {
    content: '' !important;
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
    background-size: contain !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    opacity: 0.7 !important;
    visibility: visible !important;
  }

  /* Lucide chevron-right icon as inline SVG data URI */
  .og-bases-gantt :global(.wxi-menu-right::before) {
    content: '' !important;
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E") !important;
    background-size: contain !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    opacity: 0.7 !important;
    visibility: visible !important;
  }
</style>

