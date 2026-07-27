/**
 * View-layer field-mapping types for the Bases Gantt integration.
 *
 * The mapping configuration itself ({@link FieldMappings} and its mode types)
 * is layer-neutral and lives with the data-source layer — re-exported here so
 * the view layer's many existing importers keep one import site. Only the
 * SVAR-facing task shape and the mapping validation error are view-domain.
 *
 * @module bases/types/field-mapping
 */

import type { FieldMappings } from '../../datasource/fieldMappings';

export type { FieldMappings, ProgressMode, TimeEstimateMode } from '../../datasource/fieldMappings';

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
