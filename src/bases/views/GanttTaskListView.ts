/**
 * Simple text-based TaskList view for testing Bases data integration.
 * Shows tasks with hierarchy (parent-child relationships) using text indentation.
 *
 * This view demonstrates that the BasesDataAdapter works correctly before
 * integrating with the full Gantt chart visualization.
 *
 * @module bases/views/GanttTaskListView
 */

import { setIcon, BasesView, type QueryController } from 'obsidian';
import { BasesDataAdapter } from '../services/BasesDataAdapter';
import { readFieldMappings } from '../fieldMappingConfig';
import { resolveParentLink } from '../parentLink';
import { buildHierarchy, compareByStartDate } from '../taskHierarchy';
import type { FieldMappings } from '../types/field-mapping';

/**
 * Represents a task extracted from Bases data
 */
interface GanttTask {
  path: string;
  text: string;
  start: Date | null;
  end: Date | null;
  progress: number | null;
  parents: string[];
  level: number; // Hierarchy depth (0 = root, 1 = child, etc.)
  entry: any; // BasesEntry for extracting additional properties
}

/**
 * Simple text-based task list view showing hierarchy
 */
export class GanttTaskListView extends BasesView {
  readonly type = 'obsidianGanttTaskList';
  private readonly containerEl: HTMLElement;
  private readonly adapter: BasesDataAdapter;
  private itemsContainer: HTMLElement | null = null;

  // Expand/collapse state tracking
  private readonly collapsedTasks = new Set<string>();

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller);
    this.containerEl = parentEl.createDiv({ cls: 'og-task-list-root' });
    // Pass the view to the adapter at construction (it reads this.data lazily
    // at extract time), so the adapter's basesView is set once and stays
    // readonly — no post-construction `as any` reassignment needed.
    this.adapter = new BasesDataAdapter(this);
  }

  override onload(): void {
    this.setupContainer();
    console.log('[GanttTaskListView] View loaded, waiting for data...');
  }

  override onunload(): void {
    this.itemsContainer?.empty();
    this.itemsContainer = null;
  }

  /**
   * Called by Obsidian when data changes.
   * Re-renders the task list with updated data.
   */
  public onDataUpdated(): void {
    console.log('[GanttTaskListView] Data updated. Entries:', this.data?.data?.length || 0);
    this.render();
  }

  /**
   * Setup container structure
   */
  private setupContainer(): void {
    this.containerEl.empty();
    this.containerEl.style.cssText = 'display: flex; flex-direction: column; height: 100%; padding: 12px;';

    const doc = this.containerEl.ownerDocument;

    // Add header
    const header = doc.createElement('div');
    header.className = 'og-task-list-header';
    header.style.cssText = 'margin-bottom: 12px; font-weight: 600; font-size: 14px;';
    header.textContent = 'Tasks (Hierarchical View)';
    this.containerEl.appendChild(header);

    // Add items container
    const itemsContainer = doc.createElement('div');
    itemsContainer.className = 'og-task-list-items';
    itemsContainer.style.cssText = 'flex: 1; overflow-y: auto; font-family: monospace; font-size: 13px; line-height: 1.6;';
    this.containerEl.appendChild(itemsContainer);
    this.itemsContainer = itemsContainer;
  }

  /**
   * Render the task list with current data
   */
  private render(): void {
    if (!this.itemsContainer) return;
    if (!this.data?.data) {
      this.renderEmptyState();
      return;
    }

    try {
      // Get field mappings from config
      const fieldMappings = this.getFieldMappings();

      // Extract tasks from Bases data
      const tasks = this.extractTasks(fieldMappings);

      if (tasks.length === 0) {
        this.renderEmptyState();
        return;
      }

      // Build hierarchy
      const { rootTasks, childrenMap } = this.buildHierarchy(tasks);

      // Debug: Log hierarchy info
      console.log('[GanttTaskListView] Total tasks:', tasks.length);
      console.log('[GanttTaskListView] Root tasks:', rootTasks.length);
      console.log('[GanttTaskListView] Parent property configured:', fieldMappings.parentProperty);
      console.log('[GanttTaskListView] Tasks with parents:', tasks.filter(t => t.parents.length > 0).length);
      console.log('[GanttTaskListView] Sample task parents:', tasks.slice(0, 3).map(t => ({ path: t.path, parents: t.parents })));

      // Render tasks with indentation
      this.renderTasks(rootTasks, childrenMap);
    } catch (error) {
      console.error('[GanttTaskListView] Error rendering:', error);
      this.renderError(error as Error);
    }
  }

  /**
   * Get field mappings from view config.
   *
   * Uses the shared reader (single source of truth for the `tngantt_` keys).
   * Property-agnostic: reads the user's configured start/end properties with no
   * hardcoded date-property defaults — an unset field simply yields no date.
   */
  private getFieldMappings(): FieldMappings {
    return readFieldMappings((key) => this.config?.get(key));
  }

  /**
   * Get visible properties from Bases config
   * Following TaskNotes pattern: this.config.getOrder() returns ordered property IDs
   */
  private getVisibleProperties(): string[] {
    // Get ordered properties from Bases config (configured by user in Bases UI)
    const basesPropertyIds = this.config?.getOrder() || [];
    return basesPropertyIds;
  }

  /**
   * Strip property prefix (note., file., task., formula.) to get clean property name
   * Following TaskNotes PropertyMappingService pattern
   */
  private stripPropertyPrefix(propertyId: string): string {
    const prefixes = ['note.', 'file.', 'task.', 'formula.'];
    for (const prefix of prefixes) {
      if (propertyId.startsWith(prefix)) {
        return propertyId.slice(prefix.length);
      }
    }
    return propertyId;
  }

  /**
   * Format property value for display
   * Returns raw value converted to string. Formatting happens in presentation layer.
   */
  private formatPropertyValue(value: any, propertyId?: string): string {
    if (value === null || value === undefined) return '';

    // Handle Date objects
    if (value instanceof Date) {
      return this.formatDate(value);
    }

    // Handle timestamps (ctime, mtime - milliseconds since epoch)
    if (typeof value === 'number' && (propertyId?.includes('ctime') || propertyId?.includes('mtime'))) {
      const date = new Date(value);
      return this.formatDate(date);
    }

    // Handle arrays (like tags, parents, etc.)
    if (Array.isArray(value)) {
      return value.join(', ');
    }

    // Handle objects (extract meaningful value)
    if (typeof value === 'object') {
      // Handle Bases Value objects that might have .data property
      if ('data' in value) return String(value.data);
      if ('date' in value && value.date instanceof Date) return this.formatDate(value.date);
      if ('file' in value && value.file?.path) return value.file.path;
      // Fallback: stringify
      return JSON.stringify(value);
    }

    // Primitive values
    return String(value);
  }

  /**
   * Build property metadata string for a task
   * Format: (property: value) | (property: value)
   * Following user's requested format
   */
  private buildPropertyMetadata(task: GanttTask, fieldMappings: ReturnType<typeof this.getFieldMappings>): string {
    const visibleProperties = this.getVisibleProperties();

    // No filtering - user controls everything via Properties panel
    // If they select a property, it appears in metadata
    const propertiesToShow = visibleProperties;

    const metadata: string[] = [];

    for (const propertyId of propertiesToShow) {
      try {
        // Extract value using adapter
        const value = this.adapter.extractValue(task.entry, propertyId);

        if (value === null || value === undefined || value === '') continue;

        // Format the value (pass propertyId for timestamp detection)
        const formattedValue = this.formatPropertyValue(value, propertyId);
        if (!formattedValue) continue;

        // Get clean property name (strip prefix)
        const propertyName = this.stripPropertyPrefix(propertyId);

        // Build metadata string: (property: value)
        metadata.push(`(${propertyName}: ${formattedValue})`);
      } catch (error) {
        // Skip properties that can't be extracted
        console.debug(`[GanttTaskListView] Could not extract property ${propertyId}:`, error);
      }
    }

    // Join with pipe separator
    return metadata.length > 0 ? ' ' + metadata.join(' | ') : '';
  }

  /**
   * Extract tasks from Bases entries using BasesDataAdapter
   */
  private extractTasks(fieldMappings: ReturnType<typeof this.getFieldMappings>): GanttTask[] {
    const dataItems = this.adapter.extractDataItems();
    const tasks: GanttTask[] = [];

    for (const item of dataItems) {
      const entry = item.basesData;
      if (!entry) continue;

      const task: GanttTask = {
        path: entry.file.path,
        text: this.adapter.extractText(entry, fieldMappings.textProperty),
        start: this.adapter.extractDate(entry, fieldMappings.startProperty),
        end: this.adapter.extractDate(entry, fieldMappings.endProperty),
        progress: this.adapter.extractProgress(entry, fieldMappings.progressProperty),
        parents: this.adapter.extractParents(entry, fieldMappings.parentProperty ?? ''),
        level: 0, // Will be calculated in buildHierarchy
        entry: entry, // Store entry for extracting additional properties
      };

      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Build task hierarchy based on parent references
   * Returns { rootTasks, childrenMap } for rendering
   *
   * Delegates to the pure `buildHierarchy` (src/bases/taskHierarchy.ts),
   * injecting Obsidian's link resolution so that module stays DOM/app-free and
   * unit-testable.
   */
  private buildHierarchy(tasks: GanttTask[]): { rootTasks: GanttTask[]; childrenMap: Map<string, GanttTask[]> } {
    return buildHierarchy(tasks, (parentRef, sourcePath) =>
      resolveParentLink(this.app, parentRef, sourcePath),
    );
  }

  /**
   * Toggle collapse state for a task
   */
  private toggleCollapse(taskPath: string): void {
    if (this.collapsedTasks.has(taskPath)) {
      this.collapsedTasks.delete(taskPath);
    } else {
      this.collapsedTasks.add(taskPath);
    }
    // Re-render to update visibility
    this.render();
  }

  /**
   * Assemble the single-line text for a task: indent + tree prefix + text,
   * followed by the visible-property metadata, an optional date range, and an
   * optional progress suffix. Pure string assembly extracted from renderTasks
   * to keep the DOM render method's complexity down; behavior is identical.
   */
  private buildTaskLineText(task: GanttTask, fieldMappings: ReturnType<typeof this.getFieldMappings>): string {
    const indent = '  '.repeat(task.level);
    const prefix = task.level > 0 ? '└─ ' : '';
    let text = `${indent}${prefix}${task.text}`;

    // Add visible properties metadata (following user's format)
    text += this.buildPropertyMetadata(task, fieldMappings);

    // Add date info if available
    if (task.start || task.end) {
      const startStr = task.start ? this.formatDate(task.start) : '---';
      const endStr = task.end ? this.formatDate(task.end) : '---';
      text += ` [${startStr} → ${endStr}]`;
    }

    // Add progress if available
    if (task.progress !== null) {
      text += ` (${task.progress}%)`;
    }

    return text;
  }

  /**
   * Render tasks recursively with indentation to show hierarchy
   * Following TaskNotes pattern: render all tasks using childrenMap for hierarchy
   * Phase 2: Supports expand/collapse and virtual scrolling
   */
  private renderTasks(rootTasks: GanttTask[], childrenMap: Map<string, GanttTask[]>): void {
    if (!this.itemsContainer) return;

    this.itemsContainer.empty();

    const doc = this.itemsContainer.ownerDocument;

    // Get field mappings for property filtering
    const fieldMappings = this.getFieldMappings();

    // Sort root tasks by start date (if available)
    const sortedRoots = [...rootTasks].sort(compareByStartDate);

    // Recursive render function
    const renderTask = (task: GanttTask) => {
      const taskEl = doc.createElement('div');
      taskEl.className = 'og-task-list-item';
      taskEl.style.cssText = `padding-left: ${task.level * 20}px; margin-bottom: 4px; cursor: pointer; display: flex; align-items: center;`;
      taskEl.dataset.taskPath = task.path;

      // Check if task has children
      const children = childrenMap.get(task.path) || [];
      const hasChildren = children.length > 0;
      const isCollapsed = this.collapsedTasks.has(task.path);

      // Add expand/collapse indicator for tasks with children
      if (hasChildren) {
        const indicator = doc.createElement('span');
        indicator.className = 'og-task-collapse-indicator';
        indicator.style.cssText = 'margin-right: 4px; cursor: pointer; user-select: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-muted);';

        // Use Obsidian's Lucide icons instead of Unicode characters
        setIcon(indicator, isCollapsed ? 'chevron-right' : 'chevron-down');

        // Ensure the SVG icon is visible with proper styling
        const svg = indicator.querySelector('svg');
        if (svg) {
          svg.style.width = '16px';
          svg.style.height = '16px';
          svg.style.display = 'block';
          svg.style.fill = 'currentColor';
          svg.style.stroke = 'currentColor';
        }

        // Handle indicator click (toggle collapse)
        indicator.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent task click event
          this.toggleCollapse(task.path);
        });

        taskEl.appendChild(indicator);
      } else {
        // Add spacing for alignment with tasks that have indicators
        const spacer = doc.createElement('span');
        spacer.style.cssText = 'width: 20px; display: inline-block;';
        taskEl.appendChild(spacer);
      }

      // Build task text
      const textSpan = doc.createElement('span');
      textSpan.style.cssText = 'flex: 1;';
      textSpan.textContent = this.buildTaskLineText(task, fieldMappings);
      taskEl.appendChild(textSpan);

      // Add hover effect
      taskEl.addEventListener('mouseenter', () => {
        taskEl.style.backgroundColor = 'var(--background-modifier-hover)';
      });
      taskEl.addEventListener('mouseleave', () => {
        taskEl.style.backgroundColor = '';
      });

      // Add click handler (open note)
      textSpan.addEventListener('click', () => {
        this.openTaskNote(task.path);
      });

      this.itemsContainer!.appendChild(taskEl);

      // Render children recursively if not collapsed
      if (!isCollapsed) {
        // Sort children by start date
        const sortedChildren = [...children].sort(compareByStartDate);
        for (const child of sortedChildren) {
          renderTask(child);
        }
      }
    };

    // Render all root tasks (which will recursively render their children)
    for (const rootTask of sortedRoots) {
      renderTask(rootTask);
    }
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Open task note in Obsidian
   */
  private openTaskNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      this.app.workspace.getLeaf(false).openFile(file as any);
    }
  }

  /**
   * Render empty state when no tasks found
   */
  private renderEmptyState(): void {
    if (!this.itemsContainer) return;

    this.itemsContainer.empty();
    const doc = this.itemsContainer.ownerDocument;
    const emptyEl = doc.createElement('div');
    emptyEl.className = 'og-task-list-empty';
    emptyEl.style.cssText = 'padding: 20px; text-align: center; color: var(--text-muted);';
    emptyEl.textContent = 'No tasks found in this Base.';
    this.itemsContainer.appendChild(emptyEl);
  }

  /**
   * Render error state when rendering fails
   */
  private renderError(error: Error): void {
    if (!this.itemsContainer) return;

    this.itemsContainer.empty();
    const doc = this.itemsContainer.ownerDocument;
    const errorEl = doc.createElement('div');
    errorEl.className = 'og-task-list-error';
    errorEl.style.cssText = 'padding: 20px; color: var(--text-error); background: var(--background-modifier-error); border-radius: 4px;';
    errorEl.textContent = `Error loading tasks: ${error.message || 'Unknown error'}`;
    this.itemsContainer.appendChild(errorEl);
  }

  /**
   * Focus the view
   */
  public focus(): void {
    this.containerEl?.focus();
  }

  /**
   * Get ephemeral state (scroll position)
   */
  public getEphemeralState(): { scrollTop?: number } {
    return {
      scrollTop: this.itemsContainer?.scrollTop ?? 0,
    };
  }

  /**
   * Restore ephemeral state
   */
  public setEphemeralState(state: { scrollTop?: number }): void {
    if (this.itemsContainer && state?.scrollTop !== undefined) {
      this.itemsContainer.scrollTop = state.scrollTop;
    }
  }

  /**
   * Handle resize event
   */
  public onResize(): void {
    // No special handling needed for text list
  }
}

/**
 * Factory function for Bases registration
 */
export function buildGanttTaskListViewFactory() {
  return function (controller: QueryController, containerEl: HTMLElement): GanttTaskListView {
    return new GanttTaskListView(controller, containerEl);
  };
}
