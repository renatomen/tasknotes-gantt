/**
 * The per-source promise-chain scheduling primitive under the drag executor:
 * each source note has a queue tail, and a submitted task joins the queues of
 * EVERY source it involves — it starts only after each of their current tails
 * settles, and it becomes the new tail of all of them, so later work on any
 * involved source fences behind it. Rejections propagate to the submitter but
 * never break a queue.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragSourceQueues
 */

export interface SourceQueues {
  /**
   * Append `task` to the queue of every given source (sorted, deduped): it
   * starts only after each source's current tail settles, and each source's
   * tail becomes this task — so work on ANY of the sources queues behind it.
   */
  join(sources: readonly string[], task: () => Promise<void>): Promise<void>;
}

export function createSourceQueues(): SourceQueues {
  const tails = new Map<string, Promise<void>>();

  function join(sources: readonly string[], task: () => Promise<void>): Promise<void> {
    const involved = [...new Set(sources)].sort((a, b) => a.localeCompare(b));
    const priors = involved.map((source) => tails.get(source) ?? Promise.resolve());
    const next = Promise.all(priors).then(task);
    const settled = next.catch(() => undefined);
    for (const source of involved) {
      tails.set(source, settled);
      void settled.finally(() => {
        if (tails.get(source) === settled) tails.delete(source);
      });
    }
    return next;
  }

  return { join };
}
