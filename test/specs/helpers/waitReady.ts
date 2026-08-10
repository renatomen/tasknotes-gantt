import { browser } from "@wdio/globals";

/**
 * `waitUntil` with a diagnostic that actually prints. wdio evaluates
 * `timeoutMsg` eagerly and only as a string, so every lazy `() =>` message the
 * specs used to pass was silently ignored — timeouts reported only the generic
 * text. The supported carrier for a computed message is the condition itself:
 * the Timer stores a condition-thrown error and rethrows it at expiry
 * (`waitUntil condition failed with the following reason: …`), with polling
 * continuing after each throw. This wrapper converts "not ready" into that
 * throw so `explain()` — evaluated per tick, so keep it cheap and free of
 * browser calls — always carries the last-observed state into the failure.
 *
 * Contract caveats encoded here: the wait must ALWAYS throw for not-ready (a
 * falsy final tick would fall back to the generic message), and the message
 * must never equal wdio's bare `timeout` sentinel — the non-empty prefix wdio
 * wraps around thrown messages plus the site text make that unreachable, and
 * an empty explain() is padded defensively.
 */
export async function waitUntilOrExplain(
  condition: () => boolean | Promise<boolean>,
  explain: () => string,
  options: { timeout: number; interval?: number },
): Promise<void> {
  await browser.waitUntil(async () => {
    if (await condition()) return true;
    throw new Error(explain() || "condition not met (empty diagnostic)");
  }, options);
}
