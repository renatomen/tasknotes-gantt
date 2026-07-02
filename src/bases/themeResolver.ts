/**
 * Theme resolution + Obsidian theme detection for the Gantt view (plan 002 U1).
 *
 * Split into two concerns:
 *
 * 1. **Pure resolver** (`isEffectiveDark`) — maps a user-chosen `mode` plus the
 *    current Obsidian dark/light state to a boolean that selects SVAR's real
 *    <Willow> / <WillowDark> theme component in the view. No DOM or Obsidian
 *    import, so it unit-tests in isolation (the test env is `node`, no jsdom).
 * 2. **Detection helpers** (`isObsidianDark` / `subscribeObsidianTheme`) — the
 *    thin, side-effecting reads of the live document/workspace. Injectable into
 *    the view so its behavior is testable without a live Obsidian.
 *
 * Mirrors the pure-logic-in-a-tested-module style of `barTreatment.ts` /
 * `datePolicyConfig.ts`.
 *
 * @module bases/themeResolver
 */

import type { App } from 'obsidian';

/** The per-view theme mode: follow Obsidian, or pin light/dark for this chart. */
export type ThemeMode = 'auto' | 'light' | 'dark';

/** Coerce an arbitrary stored value to a known mode; unknown → `auto`. */
export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/**
 * Read the persisted per-view theme mode (plan 002 U3), normalized to a known
 * mode (default `auto`). Pure (no Obsidian/DOM): the caller passes the Bases
 * `config.get` so the reader unit-tests in isolation; `register.getThemeMode()`
 * wraps it. Mirrors the reader style of `datePolicyConfig.readDatePolicyConfig`.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readThemeMode(get: (key: string) => unknown): ThemeMode {
  return normalizeThemeMode(get('tngantt_themeMode'));
}

/**
 * Persist the per-view theme mode (plan 002 U3/U4), swallowing a failing write
 * so a transient Bases `config.set` error can never crash the toolbar's change
 * handler. Pure aside from the injected `set` (the Bases `config.set`), so the
 * success and failure paths unit-test in isolation; `register`'s
 * `onThemeModeChange` wraps it. Mirrors {@link readThemeMode}.
 *
 * @param set - persists a per-view option value by key (the Bases `config.set`).
 * @param mode - the mode to store (already a known {@link ThemeMode}).
 */
export function persistThemeMode(set: (key: string, value: unknown) => void, mode: ThemeMode): void {
  try {
    set('tngantt_themeMode', mode);
  } catch (error) {
    console.warn('[Gantt] Failed to persist theme mode:', error);
  }
}

/**
 * Resolve whether the *effective* theme is dark, from the mode + Obsidian state.
 * `auto` follows Obsidian; `light`/`dark` override it. Unknown modes follow
 * `auto` (via {@link normalizeThemeMode}). Drives the choice between SVAR's
 * `<Willow>` and `<WillowDark>` theme components in the view.
 */
export function isEffectiveDark(mode: ThemeMode, obsidianIsDark: boolean): boolean {
  const normalized = normalizeThemeMode(mode);
  if (normalized === 'light') return false;
  if (normalized === 'dark') return true;
  return obsidianIsDark;
}

/**
 * Read whether Obsidian is currently in dark mode by inspecting `document.body`
 * for the `theme-dark` class (Obsidian toggles `theme-dark`/`theme-light` there).
 *
 * Side-effecting DOM read; kept out of the pure resolvers above so they stay
 * unit-testable. Returns `false` when no document is available.
 */
export function isObsidianDark(): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  return document.body.classList.contains('theme-dark');
}

/** Disposes a theme subscription created by {@link subscribeObsidianTheme}. */
type Unsubscribe = () => void;

/**
 * Subscribe to Obsidian theme changes, invoking `onChange` whenever the active
 * theme may have flipped. Returns a disposer.
 *
 * Primary signal: Obsidian's `css-change` workspace event (a real API; fires on
 * theme/appearance changes). A `MutationObserver` on `document.body`'s `class`
 * attribute is registered as a fallback so a light↔dark switch is caught even
 * if `css-change` does not fire for it. The caller re-reads {@link isObsidianDark}
 * inside `onChange`; this helper does not interpret the state itself.
 *
 * @param app - the Obsidian app (its `workspace.on('css-change', …)`).
 * @param onChange - invoked (no args) when the theme may have changed.
 */
export function subscribeObsidianTheme(app: App, onChange: () => void): Unsubscribe {
  const disposers: Unsubscribe[] = [];

  try {
    const ref = app.workspace.on('css-change', onChange);
    disposers.push(() => app.workspace.offref(ref));
  } catch {
    // Workspace event unavailable on this build — rely on the observer fallback.
  }

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    const observer = new MutationObserver(() => onChange());
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    disposers.push(() => observer.disconnect());
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Best-effort teardown; a failed disposer must not block the others.
      }
    }
  };
}
