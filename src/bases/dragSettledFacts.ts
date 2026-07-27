/**
 * The per-source settled-facts ledger under the drag executor: what this
 * executor's SETTLED writes imply for a source's authored facts (estimate
 * minutes, date-provenance status). The controller deliberately suppresses
 * recomputation for its own mutation events, so controller rows keep their
 * pre-write authored facts until a genuine external refresh — a queued
 * same-source gesture rebasing from those rows would re-plan against a world
 * the vault has already left (e.g. suppress the estimate write that undoes a
 * predecessor's). The ledger overlays the settled facts at dequeue, winning
 * only until a real refresh moves the row.
 *
 * Invalidation: an entry captures the live facts last seen BEFORE its write
 * settled (the write's own plan read them at dequeue). Self-write suppression
 * means only a genuine refresh can move the row afterwards — and any genuine
 * refresh re-reads the vault, which contains the settled write plus whatever
 * external edit triggered it. So a live read that differs from that baseline
 * proves a refresh delivered fresher facts than the ledger's: the entry drops
 * and the row wins. A live read equal to the baseline is still pre-refresh:
 * the ledger wins. An entry with no baseline (a cascade-written source never
 * read through the rebase) drops as soon as the row reflects its facts.
 *
 * Dependency-free (no Obsidian/Svelte/SVAR), mirroring {@link ./dragCommitPlanner}.
 *
 * @module bases/dragSettledFacts
 */

import type { DateStatus } from '../controller/datePolicy';
import type { BarBefore, PlannedWrite } from './dragCommitPlan';

/** What the settled writes imply; absent members mean "nothing settled for this". */
interface SettledAuthoredFacts {
  estimateMinutes?: number;
  dateStatus?: DateStatus;
}

/** The authored-facts slice of a live row read, the refresh-detection baseline. */
interface AuthoredFactsSnapshot {
  estimateMinutes: number | null;
  dateStatus: DateStatus | null;
}

export interface SettledFactsLedger {
  /** Fold one successfully settled write's implied authored facts in. */
  recordSettled(write: PlannedWrite): void;
  /** Overlay the settled facts onto a live row read (see the module doc). */
  rebase(sourcePath: string, live: BarBefore): BarBefore;
}

export function createSettledFactsLedger(): SettledFactsLedger {
  interface LedgerEntry {
    facts: SettledAuthoredFacts;
    baseline: AuthoredFactsSnapshot | null;
  }
  const entries = new Map<string, LedgerEntry>();
  const lastSeen = new Map<string, AuthoredFactsSnapshot>();

  function recordSettled(write: PlannedWrite): void {
    const { start, end, estimate } = write.patch;
    if (start === undefined && end === undefined && estimate === undefined) return;
    const source = write.sourcePath;
    const entry = entries.get(source) ?? { facts: {}, baseline: lastSeen.get(source) ?? null };
    if (estimate !== undefined) entry.facts.estimateMinutes = estimate;
    const prior = entry.facts.dateStatus ?? lastSeen.get(source)?.dateStatus ?? null;
    const status = settledDateStatus(prior, write.patch);
    if (status !== undefined) entry.facts.dateStatus = status;
    entries.set(source, entry);
  }

  function rebase(sourcePath: string, live: BarBefore): BarBefore {
    const seen: AuthoredFactsSnapshot = {
      estimateMinutes: live.estimateMinutes,
      dateStatus: live.dateStatus,
    };
    lastSeen.set(sourcePath, seen);
    const entry = entries.get(sourcePath);
    if (!entry) return live;
    if (refreshDelivered(entry, seen)) {
      entries.delete(sourcePath);
      return live;
    }
    return {
      ...live,
      ...(entry.facts.estimateMinutes !== undefined && {
        estimateMinutes: entry.facts.estimateMinutes,
      }),
      ...(entry.facts.dateStatus !== undefined && { dateStatus: entry.facts.dateStatus }),
    };
  }

  function refreshDelivered(
    entry: { facts: SettledAuthoredFacts; baseline: AuthoredFactsSnapshot | null },
    live: AuthoredFactsSnapshot,
  ): boolean {
    if (entry.baseline) {
      return (
        live.estimateMinutes !== entry.baseline.estimateMinutes ||
        live.dateStatus !== entry.baseline.dateStatus
      );
    }
    return (
      (entry.facts.estimateMinutes === undefined ||
        live.estimateMinutes === entry.facts.estimateMinutes) &&
      (entry.facts.dateStatus === undefined || live.dateStatus === entry.facts.dateStatus)
    );
  }

  return { recordSettled, rebase };
}

/**
 * What a settled geometry write means for the source's date-provenance status
 * — the planner's write→facts vocabulary read backwards. Writing both edges
 * authors the full span. A single-edge write only ever comes from the
 * inferred gate materialising the inferred edge, whose counterpart is already
 * authored — so it completes the span too (a placeholder, with neither edge
 * authored, is the one prior where the other edge stays inferred; the gate
 * never engages there, kept for completeness).
 */
function settledDateStatus(
  prior: DateStatus | null,
  patch: PlannedWrite['patch'],
): DateStatus | undefined {
  const authorsStart = patch.start !== undefined;
  const authorsEnd = patch.end !== undefined;
  if (!authorsStart && !authorsEnd) return undefined;
  if (authorsStart && authorsEnd) return 'complete';
  if (prior === 'placeholder') return authorsStart ? 'inferred-end' : 'inferred-start';
  return 'complete';
}
