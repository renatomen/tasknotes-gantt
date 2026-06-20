/**
 * BasesDataAdapter - Extract and convert BasesEntry values to native JavaScript types
 *
 * This adapter handles the conversion of Obsidian Bases API values following TaskNotes patterns:
 * - Direct frontmatter access for cheap operations
 * - Lazy computed property loading via getValue()
 * - Proper Bases Value object conversion
 *
 * @module bases/services/BasesDataAdapter
 */

import type { BasesEntry, BasesPropertyId } from "../register";

/**
 * Options for number conversion
 */
interface NumberConversionOptions {
  min?: number;
  max?: number;
}

/**
 * Format a Date as a local YYYY-MM-DD string (date only, no time).
 */
function formatDateYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Unwrap the raw value carried by a Bases group-key Value object.
 *
 * Bases Value objects expose their payload under different fields:
 * - FileValue: `.file` (TFile) — we surface the path so it can render as a link.
 * - DateValue: `.date` (Date object).
 * - Other Value types: `.data`.
 * Falls back to the key itself when none of those shapes are present.
 */
function unwrapBasesKeyValue(key: any): any {
  if (key.file && typeof key.file === "object") {
    return key.file.path;
  }
  if (key.date instanceof Date) {
    return key.date;
  }
  if (key.data !== undefined) {
    return key.data;
  }
  return key;
}

/**
 * Collect the cheap `file.`-prefixed properties available directly on a TFile
 * (name/basename/extension/path and stat size/ctime/mtime) without any
 * getValue() calls. Returns an empty record when no file is present.
 *
 * Only defined values are included, mirroring the original guarded assignments.
 */
function collectCheapFileProperties(file: any): Record<string, any> {
  const result: Record<string, any> = {};
  if (!file) {
    return result;
  }

  if (file.name !== undefined) result["file.name"] = file.name;
  if (file.basename !== undefined) result["file.basename"] = file.basename;
  if (file.extension !== undefined) result["file.extension"] = file.extension;
  if (file.path !== undefined) result["file.path"] = file.path;

  if (file.stat) {
    if (file.stat.size !== undefined) result["file.size"] = file.stat.size;
    if (file.stat.ctime !== undefined) result["file.ctime"] = file.stat.ctime;
    if (file.stat.mtime !== undefined) result["file.mtime"] = file.stat.mtime;
  }

  return result;
}

/**
 * Treat undefined, null, and empty string as "absent" (null); pass anything
 * else through unchanged. Mirrors the blank-handling used when reading
 * frontmatter and file properties directly.
 */
function blankToNull(value: unknown): unknown {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return value;
}

/**
 * Read a frontmatter property directly from a Bases entry (the `note.` prefix).
 * Falls back to `entry.properties` when `entry.frontmatter` is absent.
 * Returns null for undefined/null/empty-string values.
 */
function readFrontmatterProperty(entry: any, propertyName: string): unknown {
  const frontmatter = entry.frontmatter || entry.properties || {};
  return blankToNull(frontmatter[propertyName]);
}

/**
 * Read a property directly from the entry's TFile (the `file.` prefix).
 * Handles the stat-backed properties (ctime/mtime/size) and the parent
 * `folder` name specially, then falls back to direct property access.
 * Returns null for undefined/null/empty-string values.
 */
function readFileProperty(file: any, propertyName: string): unknown {
  // Special file properties that need stat access
  if (propertyName === "ctime" && file.stat?.ctime !== undefined) {
    return file.stat.ctime;
  }
  if (propertyName === "mtime" && file.stat?.mtime !== undefined) {
    return file.stat.mtime;
  }
  if (propertyName === "size" && file.stat?.size !== undefined) {
    return file.stat.size;
  }

  // Parent folder name
  if (propertyName === "folder" && file.parent) {
    return file.parent.name;
  }

  // Direct property access for other file properties
  return blankToNull(file[propertyName]);
}

/**
 * Bases data item structure (matches TaskNotes BasesDataItem)
 */
export interface BasesDataItem {
  key?: string;
  data?: any;
  file?: any;
  path?: string;
  properties?: Record<string, any>;
  frontmatter?: Record<string, any>;
  name?: string;
  basesData?: any; // Raw Bases data for formula computation
}

/**
 * Adapter for extracting and converting BasesEntry values
 * Now supports both individual field extraction AND full data extraction like TaskNotes
 */
export class BasesDataAdapter {
  constructor(private readonly basesView?: any) {}

  /**
   * Extract all data items from Bases query result (TaskNotes pattern).
   * Uses public API: basesView.data.data
   *
   * NOTE: This only extracts frontmatter and basic file properties (cheap).
   * Computed file properties (backlinks, links, etc.) are fetched lazily
   * via getComputedProperty() during rendering for visible items only.
   */
  extractDataItems(): BasesDataItem[] {
    if (!this.basesView?.data?.data) {
      return [];
    }

    const entries = this.basesView.data.data;
    return entries.map((entry: any) => ({
      key: entry.file.path,
      data: entry,
      file: entry.file,
      path: entry.file.path,
      properties: this.extractEntryProperties(entry),
      basesData: entry,
    }));
  }

  /**
   * Get grouped data from Bases (TaskNotes pattern).
   * Uses public API: basesView.data.groupedData
   *
   * Note: Returns pre-grouped data. Bases has already applied groupBy configuration.
   */
  getGroupedData(): any[] {
    return this.basesView?.data?.groupedData || [];
  }

  /**
   * Check if data is actually grouped (TaskNotes pattern).
   *
   * Note: When groupBy is configured but all items have the same value (or all null),
   * groupedData will have length 1. We need to check hasKey() to distinguish between:
   * - No groupBy configured: single group with no key (hasKey() = false)
   * - GroupBy configured, all null: single group with NullValue key (hasKey() = false)
   * - GroupBy configured, all same value: single group with value key (hasKey() = true)
   */
  isGrouped(): boolean {
    const groups = this.basesView?.data?.groupedData || [];
    if (groups.length !== 1) return groups.length > 1;

    const singleGroup = groups[0];
    return singleGroup?.hasKey?.() || false;
  }

  /**
   * Get property value from a Bases entry (TaskNotes pattern).
   * Uses public API: entry.getValue()
   */
  getPropertyValue(entry: any, propertyId: string): any {
    try {
      const value = entry.getValue(propertyId);
      return this.convertValueToNative(value);
    } catch (e) {
      console.warn(`[BasesDataAdapter] Failed to get property ${propertyId}:`, e);
      return null;
    }
  }

  /**
   * Convert group key Value to display string (TaskNotes pattern).
   * Handles Bases Value objects, particularly DateValue which has special structure.
   * For FileValue (links), returns the file path which can be rendered as a clickable link.
   */
  convertGroupKeyToString(key: any): string {
    // Check if key exists and is valid
    if (key == null || (key.hasKey && !key.hasKey())) {
      return "Unknown";
    }

    const actualValue = unwrapBasesKeyValue(key);

    // Handle null/undefined after extraction
    if (actualValue === null || actualValue === undefined) {
      return "None";
    }

    // Format Date objects as YYYY-MM-DD (date only, no time)
    if (actualValue instanceof Date) {
      return formatDateYmd(actualValue);
    }

    // Handle other types
    if (typeof actualValue === "string") {
      return actualValue || "None";
    }
    if (typeof actualValue === "number") return String(actualValue);
    if (typeof actualValue === "boolean") return actualValue ? "True" : "False";
    if (Array.isArray(actualValue)) {
      return actualValue.length > 0 ? actualValue.join(", ") : "None";
    }

    return String(actualValue);
  }

  /**
   * Lazily get a computed file property from a BasesEntry (TaskNotes pattern).
   * Call this during rendering for visible items only - NOT during bulk extraction.
   * This is much more efficient for expensive properties like backlinks.
   */
  getComputedProperty(basesEntry: any, propertyId: string): any {
    if (!basesEntry) return null;

    try {
      const value = basesEntry.getValue(propertyId);
      return this.convertValueToNative(value);
    } catch (e) {
      // A computed property (e.g. backlinks) can throw on a malformed entry;
      // degrade gracefully to null rather than failing the whole render.
      console.debug('[BasesDataAdapter] computed property failed:', propertyId, e);
      return null;
    }
  }

  /**
   * Extract properties from a BasesEntry (TaskNotes pattern).
   * Extracts frontmatter and basic file properties only (cheap operations).
   * Computed file properties (backlinks, links, etc.) are fetched lazily via getComputedProperty().
   */
  private extractEntryProperties(entry: any): Record<string, any> {
    // Extract all properties from the entry's frontmatter
    // We don't filter by visible properties here - that happens during rendering
    // This ensures all properties are available for TaskInfo creation
    const frontmatter = entry.frontmatter || entry.properties || {};

    // Merge frontmatter with cheap `file.`-prefixed TFile properties.
    // NOTE: Computed file properties (links, embeds, tags, backlinks, etc.) are NOT extracted here.
    // They are fetched lazily via getComputedProperty() during rendering to avoid expensive
    // getValue() calls for all entries. With virtualization, only visible items
    // need these properties computed.
    return { ...frontmatter, ...collectCheapFileProperties(entry.file) };
  }

  // ============================================================================
  // Field extraction methods (for Gantt-specific data mapping)
  // ============================================================================

  /**
   * Extract raw value from a BasesEntry property
   *
   * Following TaskNotes pattern:
   * - Access frontmatter/file properties directly (cheap)
   * - Only use getValue() for computed properties (expensive)
   *
   * @param entry - The BasesEntry to extract from
   * @param propertyId - The property ID to extract (e.g., "note.start", "file.name")
   * @returns The extracted value or null if empty
   */
  extractValue(entry: BasesEntry, propertyId: BasesPropertyId): unknown {
    // Parse property ID to determine source
    const parts = propertyId.split('.');
    const prefix = parts[0];
    const propertyName = parts.slice(1).join('.');

    // Access frontmatter properties directly (note. prefix)
    if (prefix === 'note' && propertyName) {
      return readFrontmatterProperty(entry, propertyName);
    }

    // Access file properties directly (file. prefix)
    if (prefix === 'file' && propertyName && entry.file) {
      return readFileProperty(entry.file as any, propertyName);
    }

    // For computed properties or formula properties, use getValue()
    try {
      const basesValue = entry.getValue(propertyId);
      return this.convertValueToNative(basesValue);
    } catch (e) {
      console.warn(`[BasesDataAdapter] Failed to get property ${propertyId}:`, e);
      return null;
    }
  }

  /**
   * Convert Bases Value object to native JavaScript value.
   * Handles: PrimitiveValue, ListValue, DateValue, FileValue, NullValue
   *
   * Based on TaskNotes implementation pattern.
   */
  private convertValueToNative(value: any): any {
    if (value == null || value.constructor?.name === "NullValue") {
      return null;
    }

    // PrimitiveValue (string, number, boolean)
    if (value.data !== undefined) {
      return value.data;
    }

    // ListValue
    if (typeof value.length === "function") {
      const len = value.length();
      const result = [];
      for (let i = 0; i < len; i++) {
        const item = value.at(i);
        result.push(this.convertValueToNative(item));
      }
      return result;
    }

    // DateValue - check for date property (more reliable than constructor check)
    if (value.date instanceof Date) {
      // Return the date as ISO string for consistency
      return value.date.toISOString();
    }

    // DateValue - legacy check with toISOString method
    if (value.constructor?.name === "DateValue" && value.toISOString) {
      return value.toISOString();
    }

    // FileValue
    if (value.file) {
      return value.file.path;
    }

    // Fallback: try to extract raw data
    return value;
  }

  /**
   * Convert a value to a Date object
   *
   * Handles ISO strings, timestamps, and Date objects
   *
   * @param value - The value to convert
   * @returns Date object or null if invalid
   */
  convertToDate(value: unknown): Date | null {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle Date objects
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    // Handle ISO strings and timestamps
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  /**
   * Convert a value to a number
   *
   * @param value - The value to convert
   * @param options - Optional min/max clamping
   * @returns Number or null if invalid
   */
  convertToNumber(value: unknown, options?: NumberConversionOptions): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    let num: number;

    if (typeof value === "number") {
      num = value;
    } else if (typeof value === "string") {
      num = Number.parseFloat(value);
    } else {
      return null;
    }

    // Check if conversion resulted in NaN
    if (Number.isNaN(num)) {
      return null;
    }

    // Apply clamping if options provided
    if (options) {
      if (options.min !== undefined && num < options.min) {
        num = options.min;
      }
      if (options.max !== undefined && num > options.max) {
        num = options.max;
      }
    }

    return num;
  }

  /**
   * Extract text value from entry, with fallback to file.basename
   *
   * @param entry - The BasesEntry to extract from
   * @param textProperty - The property ID for text (empty string = use basename)
   * @returns The text value or file basename
   */
  extractText(entry: BasesEntry, textProperty: BasesPropertyId): string {
    // If textProperty is empty string, always use file.basename
    if (textProperty === "") {
      return entry.file.basename;
    }

    const value = this.extractValue(entry, textProperty);

    if (value === null || value === undefined) {
      return entry.file.basename;
    }

    return String(value);
  }

  /**
   * Extract a status string from entry (no basename fallback).
   *
   * Unlike extractText, an unmapped/empty/missing status yields null rather than
   * the file basename — status is optional and drives bar coloring only when
   * genuinely present.
   *
   * @param entry - The BasesEntry to extract from
   * @param statusProperty - The property ID for status ("" / undefined = none)
   * @returns The raw status string, or null when unmapped/empty/missing
   */
  extractStatus(
    entry: BasesEntry,
    statusProperty: BasesPropertyId | undefined,
  ): string | null {
    if (!statusProperty) {
      return null;
    }

    const value = this.extractValue(entry, statusProperty);

    if (value === null || value === undefined || value === "") {
      return null;
    }

    return String(value);
  }

  /**
   * Extract date value from entry
   *
   * @param entry - The BasesEntry to extract from
   * @param dateProperty - The property ID for the date
   * @returns Date object or null if missing/invalid
   */
  extractDate(entry: BasesEntry, dateProperty: BasesPropertyId): Date | null {
    const value = this.extractValue(entry, dateProperty);
    const date = this.convertToDate(value);
    // Diagnostic: when a mapped date drives the bar (Bases-scoped views), a
    // non-blank scalar string that fails to parse silently collapses the bar to
    // the default duration — surface that. Restricted to non-blank strings:
    // blank strings and list/object values are not date-parse candidates and
    // would be false-positive noise on legitimate configs.
    if (date === null && typeof value === 'string' && value.trim() !== '') {
      console.warn(
        `[BasesDataAdapter] Date property "${dateProperty}" on "${entry.file?.path ?? '?'}" ` +
          `had a value that did not parse to a date:`,
        value,
      );
    }
    return date;
  }

  /**
   * Extract progress value from entry (clamped to 0-100)
   *
   * @param entry - The BasesEntry to extract from
   * @param progressProperty - The property ID for progress
   * @returns Progress number (0-100) or null if missing
   */
  extractProgress(entry: BasesEntry, progressProperty: BasesPropertyId): number | null {
    const value = this.extractValue(entry, progressProperty);
    return this.convertToNumber(value, { min: 0, max: 100 });
  }

  /**
   * Extract property value for display in grid columns
   *
   * @param entry - The BasesEntry to extract from
   * @param propertyId - The property ID to extract
   * @returns Formatted value suitable for display, or null if missing
   */
  extractPropertyValue(entry: BasesEntry, propertyId: BasesPropertyId): string | number | null {
    const value = this.extractValue(entry, propertyId);

    if (value === null || value === undefined) {
      return null;
    }

    // Handle dates - format as YYYY-MM-DD
    if (value instanceof Date) {
      return formatDateYmd(value);
    }

    // Handle arrays - join with commas
    if (Array.isArray(value)) {
      return value.map(String).join(', ');
    }

    // Handle numbers
    if (typeof value === 'number') {
      return value;
    }

    // Handle strings and other types
    return String(value);
  }

  /**
   * Extract parent task references from entry
   *
   * Handles both single parent (string) and multiple parents (array).
   * Supports plain strings and FileValue objects with file.path.
   *
   * @param entry - The BasesEntry to extract from
   * @param parentProperty - The property ID for parent references
   * @returns Array of parent file paths (empty if no parents)
   */
  extractParents(entry: BasesEntry, parentProperty: BasesPropertyId): string[] {
    // Return empty array if parent property not configured
    if (!parentProperty || parentProperty === '') {
      return [];
    }

    const value = this.extractValue(entry, parentProperty);

    // No value or null
    if (!value) {
      return [];
    }

    // Single parent (string)
    if (typeof value === 'string') {
      return [value];
    }

    // Multiple parents (array)
    if (Array.isArray(value)) {
      return value
        .map(item => {
          // Handle null/undefined
          if (item === null || item === undefined || item === '') {
            return null;
          }
          // Handle plain strings
          if (typeof item === 'string') {
            return item;
          }
          // Handle FileValue objects (from Bases API link properties)
          if (typeof item === 'object' && item.file?.path) {
            return item.file.path;
          }
          // Fallback to string conversion
          return String(item);
        })
        .filter((path): path is string => path !== null && path !== '');
    }

    // Fallback for other types (convert to string)
    return [String(value)];
  }
}
