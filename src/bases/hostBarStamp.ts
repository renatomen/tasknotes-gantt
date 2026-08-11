/* global Element */
/**
 * Stamping classes onto a SVAR host bar, and keeping them there.
 *
 * SVAR re-applies a bar's whole class list from its `task.type` on an
 * `update-task` — a Bar Fill / Strip source change re-issues the task with a
 * new treatment class — which drops anything added imperatively. Every stamped
 * class therefore needs a MutationObserver re-asserting it, or the cue silently
 * disappears on a live re-colour until the next remount.
 *
 * This module exists as plain TypeScript rather than inside the bar template
 * because jest cannot reach a `.svelte` file: the re-assertion contract has
 * broken twice and was provable only by launching real Obsidian.
 *
 * @module bases/hostBarStamp
 */

/**
 * The host `.wx-bar` for `node`, or null when the node is not inside one.
 *
 * Deliberately NOT narrowed to `HTMLElement`: `instanceof` is realm-bound, and
 * an Obsidian pop-out window is a separate realm, so narrowing here would make
 * every caller a silent no-op in a popped-out leaf. Callers that need element
 * APIs beyond `classList` narrow for themselves.
 */
export function findHostBar(node: Element, barClass: string): Element | null {
  return node.closest(`.${barClass}`);
}

/**
 * Add every token in `tokens` to `bar` and hold them there until teardown.
 *
 * Adds are `contains`-guarded, which is what makes a token safe to CO-OWN: two
 * attachments may stamp the same class (a torn bar that is also stretched owns
 * `wx-split` twice over), each teardown may remove it, and the surviving owner
 * re-asserts it on the next mutation. Never "strengthen" a teardown to stop
 * that — the convergence is the design, not a race.
 *
 * The guard is also what keeps the observer from feeding itself: `classList.add`
 * re-serializes the `class` attribute even for a token already present, which
 * queues another mutation record and would re-enter this callback forever.
 *
 * @returns a teardown that disconnects the observer and removes the tokens.
 */
export function stampOnHostBar(bar: Element, tokens: readonly string[]): () => void {
  const stamp = (): void => {
    for (const token of tokens) {
      if (!bar.classList.contains(token)) bar.classList.add(token);
    }
  };
  stamp();
  const observer = new MutationObserver(stamp);
  observer.observe(bar, { attributes: true, attributeFilter: ['class'] });
  return () => {
    observer.disconnect();
    for (const token of tokens) bar.classList.remove(token);
  };
}
