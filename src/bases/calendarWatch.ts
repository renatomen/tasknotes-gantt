/**
 * Liveness for calendar notes: one debounced re-resolve entry point fed by
 * vault/metadata events, so a calendar edit, rename, or deletion refreshes the
 * chart without any Bases notify. Pure core + thin wiring: the core is
 * scheduler-injected and Obsidian-free; the wiring subscribes the correct
 * event sources — content edits fire on the metadata cache's `changed`, but
 * renames and deletions live on the VAULT (`rename`/`delete`); the metadata
 * cache has no rename event, and the loose string `on()` overload lets a wrong
 * registration type-check and silently never fire, which is why the wiring's
 * subscription targets are pinned by test.
 *
 * Relevance: a path is relevant when it carries the calendar marker now, or
 * carried it the last time we looked (so removing the marker still triggers
 * the re-resolve that retires the calendar). The epoch is a monotonic counter
 * of relevant events; the view folds it into the entry signature so the next
 * refresh re-reads instead of reusing cached tasks.
 */

import { defaultScheduler, type TimerScheduler } from './scheduler';

export interface CalendarWatchConfig {
  /** Marker probe (metadata-cache read); called at event time. */
  isCalendarNote(path: string): boolean;
  /** Fires once per settled burst of relevant events. */
  onReResolve(): void;
  scheduler?: TimerScheduler;
  debounceMs?: number;
}

export interface CalendarWatch {
  notifyChanged(path: string): void;
  notifyRenamed(path: string, oldPath: string): void;
  notifyDeleted(path: string): void;
  /** Monotonic count of relevant events; folds into the entry signature. */
  epoch(): number;
  dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 500;

export function createCalendarWatch(config: CalendarWatchConfig): CalendarWatch {
  const scheduler = config.scheduler ?? defaultScheduler;
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const knownPaths = new Set<string>();
  let relevantEvents = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function isRelevant(path: string): boolean {
    if (config.isCalendarNote(path)) {
      knownPaths.add(path);
      return true;
    }
    return knownPaths.has(path);
  }

  function bumpAndSchedule(): void {
    if (disposed) return;
    relevantEvents += 1;
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = scheduler.setTimeout(() => {
      timer = null;
      config.onReResolve();
    }, debounceMs);
  }

  return {
    notifyChanged(path) {
      if (isRelevant(path)) bumpAndSchedule();
    },
    notifyRenamed(path, oldPath) {
      const wasKnown = knownPaths.delete(oldPath);
      if (isRelevant(path) || wasKnown) bumpAndSchedule();
    },
    notifyDeleted(path) {
      if (knownPaths.delete(path)) bumpAndSchedule();
    },
    epoch: () => relevantEvents,
    dispose() {
      disposed = true;
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * The slice of Obsidian's event surfaces the wiring subscribes. The callback is
 * any-typed because Obsidian's own `Events.on` overloads (typed per event name)
 * only assign structurally against an equally-loose callback — the wiring
 * narrows each callback itself.
 */
export interface WatchEventSource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(name: string, callback: (...args: any[]) => unknown): unknown;
  offref(ref: unknown): void;
}

export interface WatchFileLike {
  path: string;
}

/**
 * Subscribe the watch to its event sources. Content edits: metadata cache
 * `changed` (fires when the cache — frontmatter included — updates). Renames
 * and deletions: vault `rename`/`delete`.
 */
export function wireCalendarWatch(
  sources: { metadataCache: WatchEventSource; vault: WatchEventSource },
  watch: CalendarWatch,
): () => void {
  const changedRef = sources.metadataCache.on('changed', (file: WatchFileLike) => {
    watch.notifyChanged(file.path);
  });
  const renameRef = sources.vault.on('rename', (file: WatchFileLike, oldPath: string) => {
    watch.notifyRenamed(file.path, oldPath);
  });
  const deleteRef = sources.vault.on('delete', (file: WatchFileLike) => {
    watch.notifyDeleted(file.path);
  });
  return () => {
    sources.metadataCache.offref(changedRef);
    sources.vault.offref(renameRef);
    sources.vault.offref(deleteRef);
  };
}
