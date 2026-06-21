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
import type { FieldMappings, SVARTask, MappingValidationError } from "../types/field-mapping";
import { BasesDataAdapter } from "./BasesDataAdapter";
import type { BasesEntryLike } from "../types/bases-entry";
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

/** Normalized date span for a scheduled task plus how it was derived. */
interface ResolvedTaskDates {
  finalStart: Date;
  finalEnd: Date;
  dateStatus: 'complete' | 'inferred-start' | 'inferred-end';
}

/** Local start-of-day (00:00:00.000) for the given date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Local end-of-day (23:59:59.999) for the given date. */
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Normalize partial dates into a full-day span (aligns with BDD scenarios).
 * Both present → that span (`complete`); only end → single day at the due date
 * (`inferred-start`); only start → single day at the start (`inferred-end`);
 * neither → `null`, signalling an unscheduled task.
 */
function resolveTaskDates(start: Date | null, end: Date | null): ResolvedTaskDates | null {
  if (start && end) {
    return { finalStart: startOfDay(start), finalEnd: endOfDay(end), dateStatus: 'complete' };
  }
  if (end && !start) {
    return { finalStart: startOfDay(end), finalEnd: endOfDay(end), dateStatus: 'inferred-start' };
  }
  if (start && !end) {
    return { finalStart: startOfDay(start), finalEnd: endOfDay(start), dateStatus: 'inferred-end' };
  }
  return null;
}

/**
 * Copy unmapped visible property values onto the task for SVAR grid columns.
 * `skip` holds the property ids already consumed by gantt fields (or built-in
 * column ids); `extractValue` reads a single property's value for the entry.
 * Mutates and returns `task`.
 */
function appendVisibleProperties(
  task: SVARTask,
  visibleProperties: string[] | undefined,
  skip: Set<string>,
  extractValue: (propertyId: string) => unknown
): SVARTask {
  if (!visibleProperties || visibleProperties.length === 0) {
    return task;
  }
  for (const propertyId of visibleProperties) {
    if (skip.has(propertyId)) {
      continue;
    }
    const value = extractValue(propertyId);
    if (value !== null && value !== undefined) {
      // Store additional properties directly on the task object for SVAR grid access
      (task as any)[propertyId] = value;
    }
  }
  return task;
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
    entries: BasesEntryLike[],
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
    entry: BasesEntryLike,
    mappings: FieldMappings,
    visibleProperties?: string[]
  ): SVARTask {
    const id = entry.file.path;
    const text = this.adapter.extractText(entry, mappings.textProperty);
    const start = this.adapter.extractDate(entry, mappings.startProperty);
    const end = this.adapter.extractDate(entry, mappings.endProperty);
    const progress = this.adapter.extractProgress(entry, mappings.progressProperty);
    const parent = this.resolveParent(entry, mappings.parentProperty);

    // Handle partial dates intelligently (aligns with BDD scenarios)
    const dates = resolveTaskDates(start, end);
    if (!dates) {
      // No dates - create unscheduled task (red bar at today) (Scenario: Display task with no dates)
      return this.createUnscheduledTask(id, text, entry, progress, parent, visibleProperties);
    }

    // Create scheduled task - only include defined properties
    // SVAR Gantt may not handle undefined values correctly
    const task: SVARTask = {
      id,
      text,
      start: dates.finalStart,
      end: dates.finalEnd,
      type: 'task',  // Required for proper SVAR rendering
      custom: {
        obsidianPath: id,
        isUnscheduled: false,
        dateStatus: dates.dateStatus,
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

    // Add additional visible properties to the task for display in grid columns,
    // skipping any property already consumed by a gantt field.
    return appendVisibleProperties(
      task,
      visibleProperties,
      this.ganttFieldPropertyIds(mappings),
      (propertyId) => this.adapter.extractPropertyValue(entry, propertyId)
    );
  }

  /**
   * Resolve a parent reference to a vault file path (Phase 1: first parent only).
   * Returns `undefined` when no parent property is mapped or it can't be resolved.
   */
  private resolveParent(entry: BasesEntryLike, parentProperty?: string): string | undefined {
    if (!parentProperty) {
      return undefined;
    }
    const parentRefs = this.adapter.extractParents(entry, parentProperty);
    if (parentRefs.length === 0 || !parentRefs[0]) {
      return undefined;
    }
    return resolveParentLink(this.app, parentRefs[0], entry.file.path) ?? undefined;
  }

  /**
   * The property ids already consumed by gantt fields, which should not be
   * re-added as grid columns. Text falls back to `file.basename` when unmapped.
   */
  private ganttFieldPropertyIds(mappings: FieldMappings): Set<string> {
    const textPropertyId = mappings.textProperty || 'file.basename';
    return new Set([
      textPropertyId,  // Use resolved text property ID instead of empty string
      mappings.startProperty,
      mappings.endProperty,
      mappings.progressProperty,
      mappings.parentProperty
    ].filter(Boolean) as string[]);
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
    entry: BasesEntryLike,
    progress?: number | null,
    parent?: string,
    visibleProperties?: string[]
  ): SVARTask {
    const today = new Date();

    const task: SVARTask = {
      id: filePath,
      text,
      start: startOfDay(today),
      end: endOfDay(today),
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

    // Add additional visible properties (same logic as transformEntry).
    // Skip SVAR built-in column IDs OR file.basename (used for text).
    return appendVisibleProperties(
      task,
      visibleProperties,
      new Set(['text', 'start', 'end', 'progress', 'parent', 'file.basename']),
      (propertyId) => this.adapter.extractPropertyValue(entry, propertyId)
    );
  }
}
