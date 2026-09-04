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

import type { FieldMappings } from '../../datasource';
import type { Branded } from '../../brandedValue';

export type { FieldMappings, ProgressMode, TimeEstimateMode } from '../../datasource';

/**
 * The user's own mapping choices, every unset field still empty.
 *
 * Read this where the user's choice is what matters — the progress and time-estimate
 * write gates, which must not open an editor on a property the write path has no
 * target for, because a resolved estimate property is a READ fallback in Property
 * mode.
 */
export type RawFieldMappings = Branded<FieldMappings, 'view.rawFieldMappings'>;

/**
 * The same mappings as the active source resolves them: every unset field filled
 * in from TaskNotes' configuration.
 *
 * Read this where an unset field must behave as the property it resolves to —
 * which editor a cell offers, which frontmatter keys a refresh watches.
 *
 * The two are the same TypeScript type underneath, which is why they are branded
 * apart: passing the resolved set where the raw set belongs opens an editor on a
 * fallback property with no write target, and the swap is otherwise invisible to
 * the compiler and to every fixture that maps the field explicitly.
 */
export type EffectiveFieldMappings = Branded<FieldMappings, 'view.effectiveFieldMappings'>;

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
