/**
 * Obsidian property widget-type accessor.
 *
 * Reads a property's assigned widget type from Obsidian's `metadataTypeManager`,
 * the vault-wide registry that knows whether a property is `text`, `multitext`,
 * `tags`, `aliases`, `date`, `datetime`, `number`, `checkbox`, etc. This is the
 * only source that expresses the `tags` widget, so grid tag-pill rendering
 * resolves through here.
 *
 * `metadataTypeManager` is not in the public `obsidian` typings — it is reached
 * through a narrow local interface via a cast, mirroring TaskNotes'
 * `getObsidianPropertyType`. Guarded: a missing manager, missing property, or
 * non-string widget yields `null` so the caller falls through to the next
 * type source.
 *
 * @module bases/obsidianPropertyType
 */

import type { App } from 'obsidian';

/** The internal `metadataTypeManager` slice this accessor reads. */
interface MetadataTypeManagerSource {
  metadataTypeManager?: {
    properties?: Record<string, { type?: string; widget?: string } | undefined>;
  };
}

/**
 * The Obsidian widget type assigned to `propertyName`, or `null` when unknown.
 *
 * Property names are registered lowercase in the manager, so the lookup
 * lowercases the input. Prefers `widget` over the legacy `type` field.
 */
export function getObsidianPropertyWidget(app: App, propertyName: string): string | null {
  try {
    const manager = (app as unknown as MetadataTypeManagerSource).metadataTypeManager;
    const info = manager?.properties?.[propertyName.toLowerCase()];
    const widget = info?.widget ?? info?.type;
    return typeof widget === 'string' && widget.length > 0 ? widget : null;
  } catch {
    return null;
  }
}
