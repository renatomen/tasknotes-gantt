/**
 * Field mapping types for Gantt chart integration with Obsidian Bases
 *
 * These types define the mapping between Obsidian properties and SVAR Gantt fields.
 *
 * @module bases/types/field-mapping
 */

/**
 * Configuration for mapping Obsidian properties to Gantt task fields
 */
export interface FieldMappings {
  /** Property ID for task name (empty string = use file.basename) */
  textProperty: string;
  /** Property ID for task start date */
  startProperty: string;
  /** Property ID for task end/due date */
  endProperty: string;
  /** Property ID for task progress (0-100) */
  progressProperty: string;
  /** Property ID for parent task reference (empty string = no parent) */
  parentProperty?: string;
  /** Property ID for task status (empty string / unset = no status) */
  statusProperty?: string;
  /** Property ID for task priority (empty string / unset = no priority) */
  priorityProperty?: string;
}

/**
 * Task structure expected by SVAR Gantt library
 *
 * Minimum required fields: id, text, start, end
 * All tasks must have start/end dates (unscheduled tasks use today)
 */
export interface SVARTask {
  /** Unique identifier (always file.path from BasesEntry) */
  id: string;
  /** Display name for the task */
  text: string;
  /** Task start date (always set, today for unscheduled) */
  start: Date;
  /** Task end date (always set, today for unscheduled) */
  end: Date;
  /** Task duration in days (optional, calculated by SVAR) */
  duration?: number;
  /** Task progress percentage 0-100 (optional) */
  progress?: number;
  /** Parent task ID for hierarchical relationships (optional) */
  parent?: string | number;
  /** Task type (task, summary, milestone) */
  type?: 'task' | 'summary' | 'milestone';
  /** Custom metadata for Obsidian integration */
  custom?: {
    /** Original Obsidian file path */
    obsidianPath: string;
    /** Flag indicating task has no scheduled dates */
    isUnscheduled: boolean;
    /**
     * Date quality indicator (aligns with BDD scenarios)
     * - 'complete': Both start and end dates provided
     * - 'inferred-start': Only end date provided, start inferred
     * - 'inferred-end': Only start date provided, end inferred
     * - 'placeholder': No dates provided, using today
     */
    dateStatus: 'complete' | 'inferred-start' | 'inferred-end' | 'placeholder';
    // Note: Do NOT include originalEntry - causes circular reference stack overflow in SVAR
  };
}

/**
 * Validation error for field mapping
 */
export interface MappingValidationError {
  /** Path of the file with the error */
  filePath: string;
  /** Field that failed validation */
  field: keyof FieldMappings;
  /** Human-readable error message */
  message: string;
}
