/**
 * Routing decisions for the calendar-note editor — the pure half.
 *
 * A note carrying the calendar marker opens in a visual editor instead of
 * markdown. The routing happens by intercepting `setViewState` BEFORE the
 * markdown view constructs, so there is no flash and no `file-open` loop.
 *
 * Markdown stays the guaranteed floor: only a primary leaf routes, so hover
 * previews, embeds, canvas cards and search results always render markdown;
 * and an editor-typed leaf whose note has lost its marker heals itself back.
 *
 * Everything here is decision logic over plain values — the Obsidian-facing
 * glue lives in `registerCalendarEditor.ts`, so the whole decision table is
 * unit-testable.
 *
 * @module editor/calendarEditorRouting
 */

export const CALENDAR_EDITOR_VIEW_TYPE = 'tngantt-calendar-editor';

/** The shape of a view state, narrowed to what routing reads. */
export interface ViewStateLike {
  type?: string;
  active?: boolean;
  state?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RouteContext {
  /**
   * Whether this leaf is a primary workspace leaf. False for hover popovers,
   * embeds and canvas cards, which must keep rendering markdown.
   */
  isPrimaryLeaf: boolean;
  /** The note's calendar marker, or null when it carries none. */
  markerFor: (path: string) => string | null;
}

export interface RouteOptions {
  /**
   * Heal instead of route: check an ALREADY editor-typed state and send it back
   * to markdown when the marker is gone (a leaf restored from a workspace saved
   * while the plugin was disabled, or a marker deleted since).
   */
  heal?: boolean;
}

/**
 * The replacement view state, or `null` to leave the original untouched.
 * Returning null — rather than mutating — keeps the interceptor a pure
 * decision at the call site.
 */
export function routeViewState(
  state: ViewStateLike,
  context: RouteContext,
  options: RouteOptions = {},
): ViewStateLike | null {
  const filePath = readFilePath(state);
  if (filePath === null) return null;

  if (options.heal) {
    if (state.type !== CALENDAR_EDITOR_VIEW_TYPE) return null;
    return context.markerFor(filePath) === null
      ? { ...state, type: 'markdown' }
      : null;
  }

  if (state.type !== 'markdown') return null;
  if (!context.isPrimaryLeaf) return null;
  if (context.markerFor(filePath) === null) return null;

  return { ...state, type: CALENDAR_EDITOR_VIEW_TYPE };
}

function readFilePath(state: ViewStateLike): string | null {
  const file = state.state?.['file'];
  return typeof file === 'string' && file !== '' ? file : null;
}

/**
 * Whether a leaf's root places it in the primary workspace. Hover popovers and
 * canvas cards sit outside both splits and must keep rendering markdown.
 *
 * Fails CLOSED: an unplaceable leaf (a shim, a future internal) is treated as
 * non-primary, because markdown — not the editor — is the required floor.
 */
export function isPrimaryRoot(
  root: unknown,
  rootSplit: unknown,
  floatingSplit: unknown,
): boolean {
  if (root === undefined || root === null) return false;
  return root === rootSplit || root === floatingSplit;
}

/** The tab title for a note path: its basename without the extension. */
export function displayNameFor(path: string | null): string {
  if (path === null || path === '') return 'Calendar';
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/**
 * Whether an open editor must fall back to markdown. The marker can disappear
 * under an open view — a hand edit, or an external sync — and Obsidian does not
 * re-invoke `setState` for that, so the decision is made against the metadata
 * cache rather than a view lifecycle hook.
 */
export function shouldHealToMarkdown(filePath: string | null, hasMarker: boolean): boolean {
  return filePath !== null && !hasMarker;
}

let suspensions = 0;

/**
 * Run `body` with routing switched off.
 *
 * "Open as markdown" asks for the markdown view of a note that still carries
 * its marker — which is precisely what routing rewrites. Without this the
 * escape hatch silently no-ops, re-routing straight back to the editor. The
 * interceptor's decision is synchronous, so the suspension only has to span
 * the call itself, not the promise it returns.
 */
export function suspendRouting<T>(body: () => T): T {
  suspensions++;
  try {
    return body();
  } finally {
    suspensions--;
  }
}

/** Whether a caller has deliberately switched routing off for this call. */
export function isRoutingSuspended(): boolean {
  return suspensions > 0;
}

export interface ReentrancyGuard {
  /** Runs `body` unless already running; returns whether it ran. */
  run(body: () => void): boolean;
}

/**
 * Routing re-enters `setViewState`, so the interceptor must not act on its own
 * call. Releases in a `finally` — one throwing body can never wedge routing
 * off for the rest of the session.
 */
export function createReentrancyGuard(): ReentrancyGuard {
  let running = false;
  return {
    run(body) {
      if (running) return false;
      running = true;
      try {
        body();
      } finally {
        running = false;
      }
      return true;
    },
  };
}
