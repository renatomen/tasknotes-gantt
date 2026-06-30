/**
 * Maximize state machine (plan 2026-06-30-002 U1).
 *
 * Replaces SVAR's native-browser `<Fullscreen>` with a "maximize within
 * Obsidian" mode: the Gantt's own container is promoted to fill the Obsidian
 * window (CSS, done in the Svelte component) so Obsidian's popups — Edit Modal,
 * command palette, context menus, suggesters, Notices — render above it instead
 * of being hidden behind the native top layer.
 *
 * This module owns ONLY the state: enter/exit/toggle, Esc-to-exit *while
 * maximized*, and idempotent teardown. The DOM concerns (the `is-maximized`
 * class on `.og-bases-gantt`, the reactive chart-area height) live in
 * `GanttContainer.svelte`. The Escape source is injected so the state machine
 * unit-tests under the node Jest env without a real `document` — the same DI
 * shape as {@link import('./readinessController').createReadinessOrchestrator}
 * and {@link import('./basesConfigRefresh').installBasesConfigRefreshHook}.
 *
 * @module bases/maximizeController
 */

/** Registers a listener that calls `onEscape` when the user presses Escape.
 *  Returns an unregister function. Injected for testability; defaults to a
 *  `document` keydown listener in the browser. */
export type RegisterEscape = (onEscape: () => void) => () => void;

/** Injected dependencies for {@link createMaximizeController}. */
export interface MaximizeControllerDeps {
  /** Notified whenever maximized state actually changes (never on a no-op).
   *  The Svelte component re-renders the toggle + flips the container class. */
  onChange: (isMaximized: boolean) => void;
  /** Escape-key source. Required (not defaulted): the only production caller is
   *  the Svelte component, which injects an Obsidian-aware registrar (it ignores
   *  Escape while a popup is open). Injecting it also keeps this module DOM-free
   *  so it unit-tests under the node Jest env without touching `document`. */
  registerEscape: RegisterEscape;
}

/** A per-view maximize controller. */
export interface MaximizeController {
  /** Current state. */
  isMaximized(): boolean;
  /** Enter maximize (no-op if already maximized or destroyed). */
  enter(): void;
  /** Exit maximize (no-op if already embedded or destroyed). Idempotent. */
  exit(): void;
  /** Flip between maximized and embedded. */
  toggle(): void;
  /** Unregister the Escape listener and go inert. Idempotent. */
  destroy(): void;
}

/**
 * Create a maximize controller. See {@link MaximizeController}.
 *
 * The Escape listener is registered once at construction and guarded by the
 * current state — firing Escape while embedded is a no-op, while maximized it
 * exits. `destroy()` unregisters it. This keeps Esc handling symmetric with the
 * toggle and avoids re-registering on every enter/exit.
 *
 * @param deps - the change callback and (optionally) an Escape source.
 */
export function createMaximizeController(
  deps: MaximizeControllerDeps,
): MaximizeController {
  const register = deps.registerEscape;
  let maximized = false;
  let destroyed = false;

  // Registered once; the handler reads live state so an embedded Escape is inert.
  const unregister = register(() => {
    if (maximized) setState(false);
  });

  function setState(next: boolean): void {
    if (destroyed || next === maximized) return;
    maximized = next;
    deps.onChange(maximized);
  }

  return {
    isMaximized: () => maximized,
    enter: () => setState(true),
    exit: () => setState(false),
    toggle: () => setState(!maximized),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      unregister();
    },
  };
}
