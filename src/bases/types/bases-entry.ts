/**
 * Shared Bases entry types used across the Bases adapter, mapping services, and
 * view registration.
 *
 * @module bases/types/bases-entry
 */

import type { BasesPropertyId } from "obsidian";

/**
 * The runtime shape of a Bases entry that this adapter actually reads.
 *
 * **Documented loose boundary (plan 2026-06-21-001, KTD 4).** Obsidian's public
 * `BasesEntry` is intentionally narrower than the runtime object: it declares
 * only `file: TFile` and `getValue(): Value | null`, and the concrete `Value`
 * subclasses are not exported. The adapter, by deliberate design, reads cheap
 * `frontmatter`/`properties` directly (its fast path) and unwraps the raw
 * payload off `Value` objects (`.data` / `.date` / `.file`), none of which are
 * expressible against the public types. Rather than re-route through the
 * computed `getValue()` path (a behavior + perf change — out of scope), we type
 * the extraction surface against this single narrow interface and keep the
 * `Value`-unwrapping (`convertValueToNative`) behind one `any` seam.
 *
 * The official `BasesEntry` is structurally assignable to this interface, so the
 * real query entries (`view.data.data`) flow in unchanged.
 */
export interface BasesEntryLike {
  /**
   * The entry's file. The official `TFile` is assignable here; the adapter reads
   * `path`/`name`/`basename`/`stat`/`parent` plus arbitrary `file.`-prefixed
   * names off this object (via the `readFileProperty` loose-`any` helper).
   */
  file: {
    path: string;
    name: string;
    basename: string;
    stat?: { size?: number; ctime?: number; mtime?: number };
    parent?: { name?: string } | null;
  };
  /** Direct frontmatter access (the adapter's cheap fast path). */
  frontmatter?: Record<string, unknown>;
  /** Alternative property access used by some Bases versions. */
  properties?: Record<string, unknown>;
  /** Computed/formula property accessor (only used off the cheap path). */
  getValue(propertyId: string): unknown;
}

/**
 * Narrow a raw string to the official template-literal `BasesPropertyId`.
 *
 * `FieldMappings` and other config sites hold bare `string` ids (e.g.
 * `"note.start"`, `"file.name"`); the official `BasesPropertyId` is the
 * `` `${BasesPropertyType}.${string}` `` template literal. This is the single
 * documented narrowing point (KTD 4) — route raw-string→id conversions through
 * it instead of scattering ad-hoc casts. No runtime validation: callers already
 * supply prefixed ids, and `extractValue`'s `split('.')` parse is structurally
 * safe for any string.
 */
export function asPropertyId(s: string): BasesPropertyId {
  return s as BasesPropertyId;
}
