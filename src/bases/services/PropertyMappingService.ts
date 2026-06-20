/**
 * PropertyMappingService - Transform BasesEntry[] to SVARTask[]
 *
 * This service handles the three-layer property mapping:
 * BasesEntry (Bases API) → Internal representation → SVARTask (SVAR Gantt)
 *
 * Following TaskNotes architectural patterns for property mapping.
 *
 * @module bases/services/PropertyMappingService
 */

import type { App } from "obsidian";
import type { BasesEntry } from "../register";
import type { FieldMappings, SVARTask, MappingValidationError } from "../types/field-mapping";
import { BasesDataAdapter } from "./BasesDataAdapter";
import { resolveParentLink } from "../parentLink";

/**
 * Result of transforming entries
 */
export interface TransformResult {
  /** Successfully transformed tasks */
  tasks: SVARTask[];
  /** Validation errors encountered */
  errors: MappingValidationError[];
}

/**
 * Service for mapping BasesEntry data to SVAR Gantt tasks
 */
export class PropertyMappingService {
  private readonly adapter: BasesDataAdapter;
  private readonly app: App;

  constructor(app: App) {
    this.adapter = new BasesDataAdapter();
    this.app = app;
  }

  /**
   * Transform an array of BasesEntry to SVARTask[]
   *
   * @param entries - Array of BasesEntry from Bases query
   * @param mappings - Field mappings configuration
   * @param visibleProperties - Optional list of visible properties from Bases to include in task data
   * @returns Transform result with tasks and errors
   */
  transformEntries(
    entries: BasesEntry[],
    mappings: FieldMappings,
    visibleProperties?: string[]
  ): TransformResult {
    const tasks: SVARTask[] = [];
    const errors: MappingValidationError[] = [];

    for (const entry of entries) {
      try {
        const task = this.transformEntry(entry, mappings, visibleProperties);
        tasks.push(task);
      } catch (error) {
        // Log errors but continue processing other entries
        console.error(`[PropertyMappingService] ERROR transforming ${entry.file.path}:`, error);
        errors.push({
          filePath: entry.file.path,
          field: "textProperty", // Default field for general errors
          message: error instanceof Error ? error.message : "Unknown transformation error",
        });
      }
    }

    // Log summary
    console.log(`[PropertyMappingService] Transformed ${tasks.length} tasks (${errors.length} errors)`);
    if (errors.length > 0) {
      console.warn(`[PropertyMappingService] Errors:`, errors);
    }

    return { tasks, errors };
  }

  /**
   * Transform a single BasesEntry to SVARTask
   *
   * @param entry - The BasesEntry to transform
   * @param mappings - Field mappings configuration
   * @param visibleProperties - Optional list of visible properties to include in task data
   * @returns The transformed SVARTask
   */
  private transformEntry(
    entry: BasesEntry,
    mappings: FieldMappings,
    visibleProperties?: string[]
  ): SVARTask {
    const id = entry.file.path;
    const text = this.adapter.extractText(entry, mappings.textProperty);
    const start = this.adapter.extractDate(entry, mappings.startProperty);
    const end = this.adapter.extractDate(entry, mappings.endProperty);
    const progress = this.adapter.extractProgress(entry, mappings.progressProperty);

    // Extract parent references and resolve to file paths
    const parentRefs = mappings.parentProperty
      ? this.adapter.extractParents(entry, mappings.parentProperty)
      : [];

    // Resolve parent links to actual file paths (Phase 1: use first parent only)
    let parent: string | undefined = undefined;
    if (parentRefs.length > 0 && parentRefs[0]) {
      const resolvedPath = resolveParentLink(this.app, parentRefs[0], entry.file.path);
      parent = resolvedPath ?? undefined;
    }

    // Handle partial dates intelligently (aligns with BDD scenarios)
    let finalStart: Date;
    let finalEnd: Date;
    let dateStatus: 'complete' | 'inferred-start' | 'inferred-end' | 'placeholder';

    if (start && end) {
      // Both dates available - use them (Scenario: Display basic task with start and end dates)
      // Normalize to start of start day and end of end day
      finalStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
      finalEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
      dateStatus = 'complete';
    } else if (end && !start) {
      // Only end date (due date) - create single-day task at due date (Scenario: Display task with missing start date)
      // Normalize to full day span
      finalStart = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
      finalEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
      dateStatus = 'inferred-start';
    } else if (start && !end) {
      // Only start date - create single-day task at start date (Scenario: Display task with missing end date)
      // Normalize to full day span
      finalStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
      finalEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
      dateStatus = 'inferred-end';
    } else {
      // No dates - create unscheduled task (red bar at today) (Scenario: Display task with no dates)
      return this.createUnscheduledTask(id, text, entry, progress, parent, visibleProperties);
    }

    // Create scheduled task - only include defined properties
    // SVAR Gantt may not handle undefined values correctly
    const task: SVARTask = {
      id,
      text,
      start: finalStart,
      end: finalEnd,
      type: 'task',  // Required for proper SVAR rendering
      custom: {
        obsidianPath: id,
        isUnscheduled: false,
        dateStatus,
        // Do NOT include originalEntry - causes circular reference stack overflow in SVAR
      },
    };

    // Only add optional properties if they have values
    if (progress !== null && progress !== undefined) {
      task.progress = progress;
    }

    if (parent) {
      task.parent = parent;
    }

    // Add additional visible properties to the task for display in grid columns
    if (visibleProperties && visibleProperties.length > 0) {
      // Determine which property is being used for text (with fallback to file.basename)
      const textPropertyId = mappings.textProperty || 'file.basename';

      const mappedProperties = new Set([
        textPropertyId,  // Use resolved text property ID instead of empty string
        mappings.startProperty,
        mappings.endProperty,
        mappings.progressProperty,
        mappings.parentProperty
      ].filter(Boolean));

      for (const propertyId of visibleProperties) {
        // Skip if already mapped to a gantt field
        if (mappedProperties.has(propertyId)) {
          continue;
        }

        // Extract the property value
        const value = this.adapter.extractPropertyValue(entry, propertyId);
        if (value !== null && value !== undefined) {
          // Store additional properties directly on the task object for SVAR grid access
          (task as any)[propertyId] = value;
        }
      }
    }

    return task;
  }

  /**
   * Create an unscheduled task (red bar spanning today)
   *
   * @param filePath - The file path (used as ID)
   * @param text - The task text
   * @param entry - The original BasesEntry
   * @param progress - Optional progress value
   * @param parent - Optional parent task ID
   * @param visibleProperties - Optional list of visible properties to include in task data
   * @returns SVARTask with today's dates and unscheduled flag
   */
  createUnscheduledTask(
    filePath: string,
    text: string,
    entry: BasesEntry,
    progress?: number | null,
    parent?: string,
    visibleProperties?: string[]
  ): SVARTask {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const task: SVARTask = {
      id: filePath,
      text,
      start: startOfToday,
      end: endOfToday,
      type: 'task',  // Required for proper SVAR rendering
      custom: {
        obsidianPath: filePath,
        isUnscheduled: true,
        dateStatus: 'placeholder',
        // Do NOT include originalEntry - causes circular reference stack overflow in SVAR
      },
    };

    // Only add optional properties if they have values
    if (progress !== null && progress !== undefined) {
      task.progress = progress;
    }

    if (parent) {
      task.parent = parent;
    }

    // Add additional visible properties (same logic as transformEntry)
    if (visibleProperties && visibleProperties.length > 0) {
      // Skip properties that are SVAR built-in column IDs OR file.basename (used for text)
      const skipProperties = new Set(['text', 'start', 'end', 'progress', 'parent', 'file.basename']);

      for (const propertyId of visibleProperties) {
        // Skip properties that are already handled
        if (skipProperties.has(propertyId)) {
          continue;
        }

        // Extract the property value
        const value = this.adapter.extractPropertyValue(entry, propertyId);
        if (value !== null && value !== undefined) {
          // Store additional properties directly on the task object for SVAR grid access
          (task as any)[propertyId] = value;
        }
      }
    }

    return task;
  }
}
