/**
 * A unique per-view CSS scope class for a Gantt instance. Each instance anchors
 * its injected stylesheets (treatment, calendar shading) under `.<scope>` so they
 * cannot restyle a sibling view sharing `.og-bases-gantt` on the same page.
 *
 * A process-monotonic counter: deterministic, collision-free for the document's
 * lifetime, and with no randomness (or crypto dependency) to reason about — a
 * scope class carries no security weight, only uniqueness.
 *
 * @module bases/instanceScope
 */

let counter = 0;

/** The next unique `og-gantt-<token>` scope class. */
export function nextInstanceScopeClass(): string {
  counter += 1;
  return `og-gantt-${counter.toString(36)}`;
}
