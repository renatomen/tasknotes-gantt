/**
 * The settled-facts ledger: settled writes' authored facts win over a live row
 * the controller's self-write suppression left stale — and stop winning the
 * moment a genuine refresh moves the row.
 */
import { describe, it, expect } from '@jest/globals';
import { createSettledFactsLedger } from '../../src/bases/dragSettledFacts';
import type { BarBefore } from '../../src/bases/dragCommitPlan';

const SRC = 'notes/T.md';
const span = { start: new Date(2026, 7, 3), end: new Date(2026, 7, 4, 23, 59, 59) };
const live = (over: Partial<BarBefore> = {}): BarBefore => ({
  ...span,
  dateStatus: 'complete',
  estimateMinutes: 960,
  ...over,
});
const write = (patch: { start?: Date; end?: Date; estimate?: number; progress?: number }) => ({
  sourcePath: SRC,
  instanceId: SRC,
  patch,
});

describe('createSettledFactsLedger', () => {
  it('overlays a settled estimate over the stale row until a refresh moves it', () => {
    const ledger = createSettledFactsLedger();
    ledger.rebase(SRC, live()); // the writing gesture's own dequeue read (960 = the pre-write world)
    ledger.recordSettled(write({ start: span.start, end: span.end, estimate: 1920 }));

    // The row still shows the pre-write facts: the ledger wins.
    expect(ledger.rebase(SRC, live()).estimateMinutes).toBe(1920);
    // A refresh moved the row (it now reflects the vault): the row wins, for good.
    expect(ledger.rebase(SRC, live({ estimateMinutes: 1920 })).estimateMinutes).toBe(1920);
    expect(ledger.rebase(SRC, live({ estimateMinutes: 960 })).estimateMinutes).toBe(960);
  });

  it('does not outlive an external edit a refresh delivered: any row movement off the baseline drops the entry', () => {
    const ledger = createSettledFactsLedger();
    ledger.rebase(SRC, live());
    ledger.recordSettled(write({ start: span.start, end: span.end, estimate: 1920 }));

    // The refresh carries an EXTERNAL estimate edit (1440, neither the stale
    // 960 nor our 1920): the row moved off the baseline, so the row wins.
    expect(ledger.rebase(SRC, live({ estimateMinutes: 1440 })).estimateMinutes).toBe(1440);
    expect(ledger.rebase(SRC, live({ estimateMinutes: 1440 })).estimateMinutes).toBe(1440);
  });

  it('a settled single-edge write completes the inferred date status', () => {
    const ledger = createSettledFactsLedger();
    ledger.rebase(SRC, live({ dateStatus: 'inferred-end' }));
    ledger.recordSettled(write({ end: span.end }));

    expect(ledger.rebase(SRC, live({ dateStatus: 'inferred-end' })).dateStatus).toBe('complete');
  });

  it('an estimate-only settled write changes the estimate but leaves the date status alone', () => {
    const ledger = createSettledFactsLedger();
    ledger.rebase(SRC, live({ dateStatus: 'inferred-end' }));
    ledger.recordSettled(write({ estimate: 1920 }));

    const rebased = ledger.rebase(SRC, live({ dateStatus: 'inferred-end' }));
    expect(rebased.estimateMinutes).toBe(1920);
    expect(rebased.dateStatus).toBe('inferred-end');
  });

  it('ignores progress-only writes and untouched sources', () => {
    const ledger = createSettledFactsLedger();
    ledger.recordSettled(write({ progress: 50 }));

    expect(ledger.rebase(SRC, live())).toEqual(live());
    expect(ledger.rebase('notes/other.md', live())).toEqual(live());
  });

  it('a source never read through the rebase (a cascade-written child) drops once the row reflects the settled facts', () => {
    const ledger = createSettledFactsLedger();
    ledger.recordSettled(write({ start: span.start, end: span.end }));

    // Pre-refresh the row still says inferred-end: the ledger completes it.
    expect(ledger.rebase(SRC, live({ dateStatus: 'inferred-end' })).dateStatus).toBe('complete');
    // The row caught up: the entry drops, and later reads pass through.
    expect(ledger.rebase(SRC, live({ dateStatus: 'complete' })).dateStatus).toBe('complete');
    expect(ledger.rebase(SRC, live({ dateStatus: 'inferred-start' })).dateStatus).toBe('inferred-start');
  });
});
