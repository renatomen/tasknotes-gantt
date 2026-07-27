/**
 * The derivation table: equivalence classes over the span↔estimate derivation
 * authority, spanning edge {start, end} × meaning {calendar-days, working-days}
 * × blocking class {no calendar / broken association, span-has-working-days,
 * locally-all-blocked-but-walkable, ceiling-exceeded} × pre-drag shape
 * {two dates, one-sided}. Expectations pin the read path's established
 * behaviour (the same fixtures the controller stretch tests render), so the
 * write path asking this module gets byte-identical answers.
 *
 * Impossible/degenerate combinations, named and excluded:
 * - calendar-days meaning × any blocking class beyond "present/absent" — the
 *   meaning gate never consults blocking, so the classes cannot differ.
 * - two-dates (complete/swapped) × blocking classes — an authored span never
 *   walks, so walkable vs ceiling cannot differ; one split row covers it.
 * - placeholder shape × edges — no edge is derived from an estimate.
 */
import { describe, it, expect } from '@jest/globals';
import {
  computeTaskBlocking,
  deriveEstimate,
  deriveSpan,
  projectPlainSpan,
  spanEvaluationWindow,
  type SpanDerivationFacts,
  type TaskBlocking,
} from '../../src/controller/calendar/derivation';
import type { CalendarNoteInput, LinkResolver } from '../../src/controller/calendar/resolveCalendars';

const day = (iso: string): Date => new Date(`${iso}T00:00:00`);
const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999`);
const iso = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Sat/Sun blocked — the span-has-working-days class. */
const weekends: TaskBlocking = {
  isBlocked: (dayIso) => {
    const weekday = new Date(`${dayIso}T00:00:00Z`).getUTCDay();
    return weekday === 0 || weekday === 6;
  },
  maxBlockedRunDays: 2,
};

/** Every day blocked — the ceiling-exceeded class. */
const fullyBlocked: TaskBlocking = { isBlocked: () => true, maxBlockedRunDays: 3 };

/** A blocking spy that records how often the derivation consulted it. */
const countingBlocking = (): TaskBlocking & { consultations: () => number } => {
  let calls = 0;
  return {
    isBlocked: (dayIso) => {
      calls += 1;
      return weekends.isBlocked(dayIso);
    },
    maxBlockedRunDays: 2,
    consultations: () => calls,
  };
};

/**
 * Default facts: Friday 2026-08-07 anchoring a 3-working-day inferred end whose
 * plain span is Fri..Sun — the same fixture the controller's stretch tests pin.
 */
const facts = (overrides: Partial<SpanDerivationFacts> = {}): SpanDerivationFacts => ({
  start: day('2026-08-07'),
  end: dayEnd('2026-08-09'),
  dateStatus: 'inferred-end',
  meaning: 'working-days',
  rendering: 'shaded',
  blocking: weekends,
  defaultDurationDays: 1,
  ...overrides,
});

describe('deriveSpan — one-sided, working-days', () => {
  it('end edge over a span with working days: stretches past the weekend, unflagged', () => {
    const derived = deriveSpan(facts(), 3 * 1440);
    expect(iso(derived.start)).toBe('2026-08-07');
    expect(iso(derived.end)).toBe('2026-08-11'); // Fri + Mon + Tue
    expect(derived.flagged).toBe(false);
  });

  it('start edge over a span with working days: stretches back past the weekend, unflagged', () => {
    const derived = deriveSpan(
      facts({ dateStatus: 'inferred-start', start: day('2026-08-09'), end: dayEnd('2026-08-10') }),
      2 * 1440,
    );
    expect(iso(derived.start)).toBe('2026-08-07'); // Mon + Fri
    expect(iso(derived.end)).toBe('2026-08-10');
    expect(derived.flagged).toBe(false);
  });

  it('end edge, locally all blocked but walkable: the walk SUCCEEDS unflagged', () => {
    // A 1-day estimate anchored on Saturday: the plain span is fully blocked,
    // but working days exist past it — the walk lands on Monday, never flagged.
    const derived = deriveSpan(
      facts({ start: day('2026-08-08'), end: dayEnd('2026-08-08') }),
      1440,
    );
    expect(iso(derived.end)).toBe('2026-08-10');
    expect(derived.flagged).toBe(false);
  });

  it('start edge, locally all blocked but walkable: walks back unflagged', () => {
    const derived = deriveSpan(
      facts({ dateStatus: 'inferred-start', start: day('2026-08-09'), end: dayEnd('2026-08-09') }),
      1440,
    );
    expect(iso(derived.start)).toBe('2026-08-07');
    expect(derived.flagged).toBe(false);
  });

  it('end edge, ceiling exceeded: the plain span survives and flagged rides the RESULT', () => {
    const derived = deriveSpan(facts({ blocking: fullyBlocked, rendering: 'split' }), 2 * 1440);
    expect(iso(derived.start)).toBe('2026-08-07');
    expect(iso(derived.end)).toBe('2026-08-09');
    expect(derived.flagged).toBe(true);
    // A flagged fallback suppresses ghost runs even under split rendering.
    expect(derived.ghostRuns).toEqual([]);
  });

  it('start edge, ceiling exceeded: plain span plus the flag', () => {
    const derived = deriveSpan(
      facts({ dateStatus: 'inferred-start', blocking: fullyBlocked }),
      2 * 1440,
    );
    expect(iso(derived.start)).toBe('2026-08-07');
    expect(iso(derived.end)).toBe('2026-08-09');
    expect(derived.flagged).toBe(true);
  });

  it('a null estimate walks with the default duration instead', () => {
    const derived = deriveSpan(facts({ defaultDurationDays: 3 }), null);
    expect(iso(derived.end)).toBe('2026-08-11');
  });

  it('a sub-day estimate floors to one working day', () => {
    const derived = deriveSpan(facts({ end: dayEnd('2026-08-07') }), 90);
    expect(iso(derived.end)).toBe('2026-08-07');
    expect(derived.flagged).toBe(false);
  });
});

describe('deriveSpan — no calendar / broken association', () => {
  it.each(['inferred-end', 'inferred-start'] as const)(
    '%s edge collapses to the plain span with empty provenance',
    (dateStatus) => {
      const derived = deriveSpan(facts({ dateStatus, blocking: null, rendering: 'split' }), 3 * 1440);
      expect(iso(derived.start)).toBe('2026-08-07');
      expect(iso(derived.end)).toBe('2026-08-09');
      expect(derived.flagged).toBe(false);
      expect(derived.ghostRuns).toEqual([]);
    },
  );
});

describe('deriveSpan — calendar-days meaning', () => {
  it.each(['inferred-end', 'inferred-start'] as const)(
    '%s edge stays flat and never consults blocking',
    (dateStatus) => {
      const spy = countingBlocking();
      const derived = deriveSpan(facts({ dateStatus, meaning: 'calendar-days', blocking: spy }), 3 * 1440);
      expect(iso(derived.start)).toBe('2026-08-07');
      expect(iso(derived.end)).toBe('2026-08-09');
      expect(derived.flagged).toBe(false);
      expect(spy.consultations()).toBe(0);
    },
  );
});

describe('deriveSpan — two-dates shape (authored spans)', () => {
  it('never moves an authored complete span, even fully blocked under working-days', () => {
    const derived = deriveSpan(
      facts({ dateStatus: 'complete', start: day('2026-08-07'), end: dayEnd('2026-08-17'), blocking: fullyBlocked }),
      null,
    );
    expect(iso(derived.start)).toBe('2026-08-07');
    expect(iso(derived.end)).toBe('2026-08-17');
    expect(derived.flagged).toBe(false);
  });

  it('splits an authored span without re-projecting it (rendering axis alone)', () => {
    const derived = deriveSpan(
      facts({
        dateStatus: 'complete',
        meaning: 'calendar-days',
        rendering: 'split',
        start: day('2026-08-07'),
        end: dayEnd('2026-08-11'),
      }),
      null,
    );
    expect(iso(derived.start)).toBe('2026-08-07');
    expect(iso(derived.end)).toBe('2026-08-11');
    expect(derived.ghostRuns).toEqual([{ startDate: '2026-08-08', days: 2 }]);
  });

  it('degrades a fully-blocked split span to a continuous bar (no ghost runs)', () => {
    const derived = deriveSpan(
      facts({
        dateStatus: 'complete',
        meaning: 'calendar-days',
        rendering: 'split',
        start: day('2026-08-08'),
        end: dayEnd('2026-08-09'),
      }),
      null,
    );
    expect(derived.ghostRuns).toEqual([]);
  });
});

describe('deriveSpan — ghost runs match the read path for the same facts', () => {
  it('the stretched split bar carries exactly the runs the read path renders', () => {
    // Mirrors the controller AE1 rendering pin: Fri + 3 working days under split
    // rendering shows the weekend as one ghost run inside the stretched bar.
    const derived = deriveSpan(facts({ rendering: 'split' }), 3 * 1440);
    expect(derived.ghostRuns).toEqual([{ startDate: '2026-08-08', days: 2 }]);
    expect(derived.flagged).toBe(false);
  });
});

describe('deriveEstimate', () => {
  it('counts only the working days of a mixed span', () => {
    const derived = deriveEstimate(facts(), { start: day('2026-08-07'), end: dayEnd('2026-08-11') });
    expect(derived.days).toBe(3); // Fri + Mon + Tue
  });

  it('floors a fully-blocked span to one day', () => {
    const derived = deriveEstimate(facts(), { start: day('2026-08-08'), end: dayEnd('2026-08-09') });
    expect(derived.days).toBe(1);
  });

  it('calendar-days meaning yields null and never consults blocking for the count', () => {
    const spy = countingBlocking();
    const derived = deriveEstimate(facts({ meaning: 'calendar-days', blocking: spy }), {
      start: day('2026-08-07'),
      end: dayEnd('2026-08-11'),
    });
    expect(derived.days).toBeNull();
    expect(spy.consultations()).toBe(0);
  });

  it('no calendar yields null (the plain span is the record)', () => {
    const derived = deriveEstimate(facts({ blocking: null }), {
      start: day('2026-08-07'),
      end: dayEnd('2026-08-11'),
    });
    expect(derived.days).toBeNull();
  });

  it('carries echo geometry: the span itself plus its ghost runs, never a flag', () => {
    const derived = deriveEstimate(facts({ rendering: 'split' }), {
      start: day('2026-08-07'),
      end: dayEnd('2026-08-11'),
    });
    expect(iso(derived.start)).toBe('2026-08-07');
    expect(iso(derived.end)).toBe('2026-08-11');
    expect(derived.flagged).toBe(false);
    expect(derived.ghostRuns).toEqual([{ startDate: '2026-08-08', days: 2 }]);
  });
});

describe('projectPlainSpan', () => {
  it('lays a derived end forward from its anchor, inclusive of the anchor day', () => {
    const plain = projectPlainSpan('end', day('2026-08-07'), 3);
    expect(iso(plain.start)).toBe('2026-08-07');
    expect(iso(plain.end)).toBe('2026-08-09');
    expect(plain.dateStatus).toBe('inferred-end');
  });

  it('lays a derived start backward from its anchor', () => {
    const plain = projectPlainSpan('start', day('2026-08-10'), 2);
    expect(iso(plain.start)).toBe('2026-08-09');
    expect(iso(plain.end)).toBe('2026-08-10');
    expect(plain.dateStatus).toBe('inferred-start');
  });
});

describe('computeTaskBlocking (blocking-facts assembly)', () => {
  const markedNotes: CalendarNoteInput[] = [
    {
      path: 'Calendars/NZ.md',
      basename: 'NZ',
      frontmatter: {
        tngantt: 'calendar',
        pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        non_working: [{ start: '2026-04-15', end: '2026-04-16' }, { start: '2026-08-03', end: '2026-08-05' }],
      },
    },
  ];
  const resolveLink: LinkResolver = (linkText) =>
    linkText.includes('NZ') ? 'Calendars/NZ.md' : null;
  const taskSpans = [{ start: new Date(2026, 3, 6), end: new Date(2026, 3, 20) }];

  it('blocks pattern-complement days and authored spans; working days pass', () => {
    const blockingOf = computeTaskBlocking({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans,
      extraWindowDays: 30,
    });
    const blocking = blockingOf('Tasks/T.md');
    if (!blocking) throw new Error('expected blocking for the associated task');
    expect(blocking.isBlocked('2026-04-11')).toBe(true); // Saturday (complement)
    expect(blocking.isBlocked('2026-04-15')).toBe(true); // authored
    expect(blocking.isBlocked('2026-04-16')).toBe(true);
    expect(blocking.isBlocked('2026-04-14')).toBe(false);
    expect(blocking.maxBlockedRunDays).toBeGreaterThanOrEqual(2);
  });

  it('a task with no or a broken association never blocks (null lookup)', () => {
    const blockingOf = computeTaskBlocking({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[Ghost]]', taskPath: 'Tasks/Broken.md' }],
      taskSpans,
      extraWindowDays: 30,
    });
    expect(blockingOf('Tasks/Broken.md')).toBeNull();
    expect(blockingOf('Tasks/Unassociated.md')).toBeNull();
  });

  it('days beyond the materialized window read as working (bounded degrade)', () => {
    const build = (extraWindowDays: number) =>
      computeTaskBlocking({
        markedNotes,
        resolveLink,
        associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
        taskSpans,
        extraWindowDays,
      })('Tasks/T.md');
    // Window end-exclusive at extra 30: 2026-04-20 + 93 days = 2026-07-22 —
    // the authored August run sits beyond it and reads working.
    expect(build(30)?.isBlocked('2026-08-04')).toBe(false);
    // A wider headroom covers it.
    expect(build(150)?.isBlocked('2026-08-04')).toBe(true);
  });

  it('returns a null-only lookup when no span bounds a window', () => {
    const blockingOf = computeTaskBlocking({
      markedNotes,
      resolveLink,
      associations: [{ value: '[[NZ]]', taskPath: 'Tasks/T.md' }],
      taskSpans: [],
      extraWindowDays: 30,
    });
    expect(blockingOf('Tasks/T.md')).toBeNull();
  });
});

describe('spanEvaluationWindow', () => {
  it('pads the min/max span extent by the margin', () => {
    const window = spanEvaluationWindow(
      [
        { start: new Date(2026, 3, 6), end: new Date(2026, 3, 14) },
        { start: new Date(2026, 3, 1), end: new Date(2026, 3, 10) },
      ],
      10,
    );
    expect(window).toEqual({ startDate: '2026-03-22', endDateExclusive: '2026-04-25' });
  });

  it('returns null with no dated spans and skips invalid dates', () => {
    expect(spanEvaluationWindow([])).toBeNull();
    expect(
      spanEvaluationWindow(
        [
          { start: new Date(Number.NaN), end: new Date(Number.NaN) },
          { start: new Date(2026, 3, 6), end: new Date(2026, 3, 7) },
        ],
        1,
      ),
    ).toEqual({ startDate: '2026-04-05', endDateExclusive: '2026-04-09' });
  });
});
