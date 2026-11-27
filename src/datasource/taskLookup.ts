/**
 * One path lookup for every TaskNotes read that would otherwise call `tasks.get`.
 *
 * A release that offers `getByPath` is used even when that call finds nothing.
 * Falling through to `get` on a miss would keep the deprecated getter alive.
 *
 * @module datasource/taskLookup
 */

/** The slice of a task API that can resolve a task from its note path. */
export interface TaskPathLookup<T> {
  getByPath?(path: string): Promise<T | null | undefined> | T | null | undefined;
  get?(path: string): Promise<T | null | undefined> | T | null | undefined;
}

/**
 * Whether this TaskNotes release resolves a task from its note path by `getByPath`.
 * Later icon state reads the same answer, so the two cannot drift.
 */
export function offersGetByPath<T>(
  tasks: TaskPathLookup<T> | null | undefined,
): tasks is TaskPathLookup<T> & {
  getByPath: (path: string) => Promise<T | null | undefined> | T | null | undefined;
} {
  return typeof tasks?.getByPath === 'function';
}

/** Whether any path lookup is offered. A miss is not the same as absence. */
export function canLookupTaskByPath(
  tasks: TaskPathLookup<unknown> | null | undefined,
): boolean {
  return offersGetByPath(tasks) || typeof tasks?.get === 'function';
}

/** Resolve `path` through `getByPath` when it is a function, otherwise through `get`. */
export async function lookupTaskByPath<T>(
  tasks: TaskPathLookup<T> | null | undefined,
  path: string,
): Promise<T | null | undefined> {
  if (offersGetByPath(tasks)) {
    return tasks.getByPath(path);
  }
  const get = tasks?.get;
  if (typeof get === 'function') {
    return get(path);
  }
  return undefined;
}
