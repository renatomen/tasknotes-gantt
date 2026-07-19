import { describe, expect, it } from '@jest/globals';
import {
  TODAY_MARKER_ID,
  buildMarkerOverlay,
  type MarkerInput,
  type OverlaySpan,
} from '../../src/bases/markerOverlay';

const MS_PER_DAY = 86_400_000;

/** Linear day-diff span standing in for SVAR's own scale arithmetic. */
const span = (startDay: number, endDay: number, widthPx = 1000): OverlaySpan => ({
  start: new Date(2026, 3, startDay),
  end: new Date(2026, 3, endDay),
  lengthUnit: 'day',
  widthPx,
  diff: (a, b) => Math.round((a.getTime() - b.getTime()) / MS_PER_DAY),
});

const marker = (over: Partial<MarkerInput> & { date: string }): MarkerInput => ({
  calendarId: 'Calendars/NZ.md',
  calendarName: 'NZ',
  color: '#2a9d8f',
  name: over.date,
  ...over,
});

const today = new Date(2026, 3, 15);

describe('buildMarkerOverlay', () => {
  it('places a marker at its fraction of the chart span', () => {
    const [entry] = buildMarkerOverlay({
      markers: [marker({ date: '2026-04-11' })],
      span: span(1, 21),
      today: null,
    });
    expect(entry?.xFraction).toBeCloseTo(0.5); // day 11 of the 1..21 span
    expect(entry?.color).toBe('#2a9d8f');
    expect(entry?.label).toBe('2026-04-11');
  });

  it('drops a marker outside the drawn span', () => {
    const entries = buildMarkerOverlay({
      markers: [marker({ date: '2026-03-01' }), marker({ date: '2026-05-30' })],
      span: span(1, 21),
      today: null,
    });
    expect(entries).toEqual([]);
  });

  it('stacks same-date markers deterministically by calendar then name', () => {
    const entries = buildMarkerOverlay({
      markers: [
        marker({ date: '2026-04-11', calendarId: 'B.md', name: 'Beta' }),
        marker({ date: '2026-04-11', calendarId: 'A.md', name: 'Alpha' }),
      ],
      span: span(1, 21),
      today: null,
    });
    expect(entries.map((e) => e.label)).toEqual(['Alpha', 'Beta']);
    expect(entries.map((e) => e.stackIndex)).toEqual([0, 1]);
    expect(entries[0]?.xFraction).toBeCloseTo(entries[1]!.xFraction);
  });

  it('groups markers whose labels would overlap, not merely identical dates', () => {
    // Two adjacent days across a 400-day span: ~1px apart at 1000px wide.
    const entries = buildMarkerOverlay({
      markers: [marker({ date: '2026-04-10' }), marker({ date: '2026-04-11' })],
      span: { ...span(1, 400), widthPx: 1000 },
      today: null,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.groupedCount).toBe(2);
    expect(entries[0]?.label).toContain('2 markers');
  });

  it('keeps well-separated markers ungrouped at the same zoom', () => {
    const entries = buildMarkerOverlay({
      markers: [marker({ date: '2026-04-10' }), marker({ date: '2026-07-19' })],
      span: { ...span(1, 400), widthPx: 1000 },
      today: null,
    });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.groupedCount === 1)).toBe(true);
  });

  it('collapses a crowded group to a count with the members in its tooltip', () => {
    const crowded = Array.from({ length: 5 }, (_, i) =>
      marker({ date: `2026-04-1${i}`, name: `M${i}` }),
    );
    const entries = buildMarkerOverlay({
      markers: crowded,
      span: { ...span(1, 400), widthPx: 1000 },
      today: null,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.groupedCount).toBe(5);
    expect(entries[0]?.title).toContain('M0');
    expect(entries[0]?.title).toContain('M4');
  });

  it('emits the today line as a generated marker', () => {
    const entries = buildMarkerOverlay({ markers: [], span: span(1, 21), today });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(TODAY_MARKER_ID);
    expect(entries[0]?.isToday).toBe(true);
    expect(entries[0]?.xFraction).toBeCloseTo(0.7); // day 15 of 1..21
  });

  it('omits the today line when today is outside the drawn span', () => {
    const entries = buildMarkerOverlay({
      markers: [],
      span: span(1, 10),
      today: new Date(2026, 5, 1),
    });
    expect(entries).toEqual([]);
  });

  it('never groups the today line into a calendar marker group', () => {
    const entries = buildMarkerOverlay({
      markers: [marker({ date: '2026-04-15', name: 'Same day' })],
      span: { ...span(1, 400), widthPx: 1000 },
      today,
    });
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.isToday)).toHaveLength(1);
  });

  it('contributes nothing when the span snapshot is absent (graceful off)', () => {
    expect(buildMarkerOverlay({ markers: [marker({ date: '2026-04-11' })], span: null, today })).toEqual(
      [],
    );
  });

  it('falls back to a theme colour for an unsafe authored colour', () => {
    const [entry] = buildMarkerOverlay({
      markers: [marker({ date: '2026-04-11', color: 'url(javascript:alert(1))' })],
      span: span(1, 21),
      today: null,
    });
    expect(entry?.color).not.toContain('javascript');
  });
});
