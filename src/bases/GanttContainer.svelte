<script lang="ts">
  import { Gantt, Willow } from '@svar-ui/svelte-gantt';
  import { Toolbar } from '@svar-ui/svelte-toolbar';

  // Type definitions for Gantt API (simplified to avoid strict typing issues)
  interface GanttTask {
    id: string;
    text: string;
    start: string;
    end: string;
    progress: number;
  }

  // Use any for SVAR API to avoid complex type definitions
  type GanttAPI = any;

  // Note: SVAR Gantt may generate console warnings:
  // - Non-passive event listeners for touch/wheel (required for drag functionality)
  // - Performance violations during chart rendering (expected for complex UI)
  // CSP violations for external fonts are prevented by fonts={false} and custom icon implementation

  let api: GanttAPI = $state();
  let editingTask: GanttTask | null = $state(null);
  let showEditor = $state(false);

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

    // Intercept the show-editor event to use our custom editor
    api.intercept("show-editor", ({ id }: { id: string }) => {
      if (id) {
        editingTask = api?.getState().tasks.byId(id);
        showEditor = true;
      }
      return false; // Prevent default editor
    });
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
  const tasks = [
    {
      id: 1,
      start: new Date(2025, 0, 2),
      end: new Date(2025, 0, 17),
      text: "Project planning",
      progress: 30,
      parent: 0,
      type: "summary",
      open: true,
    },
    {
      id: 10,
      start: new Date(2025, 0, 2),
      end: new Date(2025, 0, 5),
      text: "Design phase",
      progress: 100,
      parent: 1,
      type: "task",
    },
    {
      id: 11,
      start: new Date(2025, 0, 5),
      end: new Date(2025, 0, 12),
      text: "Development",
      progress: 60,
      parent: 1,
      type: "task",
    },
    {
      id: 12,
      start: new Date(2025, 0, 12),
      end: new Date(2025, 0, 16),
      text: "Testing",
      progress: 10,
      parent: 1,
      type: "task",
    },
  ];

  const links = [
    { id: 1, source: 10, target: 11, type: "e2s" },
    { id: 2, source: 11, target: 12, type: "e2s" },
  ];

  const scales = [
    { unit: "month", step: 1, format: "MMMM yyy" },
    { unit: "day", step: 1, format: "d" },
  ];
</script>

<div class="og-bases-gantt">
  <Willow fonts={false}>
    <Toolbar items={toolbarItems} />
    <div class="gtcell">
      <Gantt
        init={initGantt}
        {tasks}
        {links}
        {scales}
      />
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
</style>

