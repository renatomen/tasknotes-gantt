/**
 * Marker overlay geometry: flagged calendar events (and the generated today
 * line) as vertical lines positioned across the whole chart area.
 *
 * SVAR only creates per-column cells at day/hour units, so a cell-class marker
 * would vanish at the week/month/quarter zooms people actually plan at. The
 * overlay is therefore plugin-owned and date-anchored: each entry's x is a
 * fraction of the drawn chart span, taken from the contract choke-point's
 * scale snapshot, so panning and virtualization cannot hide a marker and no
 * new private state is read.
 *
 * Pure module — the span snapshot is injected, so all of it unit-tests without
 * SVAR or Obsidian.
 */

import { isSafeColor } from './barTreatment';
import type { DiffFn } from '../render/segmentLayout';

/** The drawn chart span, as read through the contract choke-point. */
export interface OverlaySpan {
  start: Date;
  end: Date;
  lengthUnit: string;
  /** Rendered chart width in px, for proximity grouping. */
  widthPx: number;
  diff: DiffFn;
}

export interface MarkerInput {
  date: string;
  name: string | undefined;
  calendarId: string;
  calendarName: string;
  color: string | undefined;
}

export interface MarkerOverlayEntry {
  id: string;
  xFraction: number;
  label: string;
  /** Full text for the tooltip — every member when the entry is a group. */
  title: string;
  color: string;
  /** Vertical offset slot for markers sharing an x position. */
  stackIndex: number;
  /** 1 for a lone marker; >1 when nearby markers collapsed into this entry. */
  groupedCount: number;
  isToday: boolean;
}

export interface MarkerOverlayInputs {
  markers: readonly MarkerInput[];
  span: OverlaySpan | null;
  today: Date | null;
}

export const TODAY_MARKER_ID = 'og-marker-today';

/** Labels closer than this many px collide, so their markers group. */
const PROXIMITY_TOLERANCE_PX = 72;
/** Theme fallback when a calendar's authored colour is unsafe or absent. */
const DEFAULT_MARKER_COLOR = 'var(--text-accent)';

export function buildMarkerOverlay(inputs: MarkerOverlayInputs): MarkerOverlayEntry[] {
  const { span } = inputs;
  if (span === null) return [];

  const total = span.diff(span.end, span.start, span.lengthUnit);
  if (!Number.isFinite(total) || total <= 0) return [];

  const placed = inputs.markers
    .map((marker) => placeMarker(marker, span, total))
    .filter((entry): entry is PlacedMarker => entry !== null)
    .sort(byPosition);

  const entries = groupByProximity(placed, span.widthPx);
  const todayEntry = placeToday(inputs.today, span, total);
  return todayEntry === null ? entries : [...entries, todayEntry];
}

interface PlacedMarker {
  xFraction: number;
  marker: MarkerInput;
}

function placeMarker(marker: MarkerInput, span: OverlaySpan, total: number): PlacedMarker | null {
  const date = isoToLocalDate(marker.date);
  if (date === null) return null;
  const offset = span.diff(date, span.start, span.lengthUnit);
  if (!Number.isFinite(offset) || offset < 0 || offset > total) return null;
  return { xFraction: offset / total, marker };
}

function byPosition(a: PlacedMarker, b: PlacedMarker): number {
  if (a.xFraction !== b.xFraction) return a.xFraction - b.xFraction;
  const byCalendar = a.marker.calendarId.localeCompare(b.marker.calendarId);
  return byCalendar !== 0 ? byCalendar : labelOf(a.marker).localeCompare(labelOf(b.marker));
}

/**
 * Markers whose rendered labels would overlap collapse into one entry — the
 * rule is rendered proximity, not identical dates, so adjacent days collide at
 * month zoom while staying separate at day zoom.
 *
 * A cluster of markers all sharing one position is the exception: they cannot
 * be separated horizontally at any zoom, so they stack vertically and stay
 * individually readable. Once a cluster mixes positions, stacking would leave
 * near-neighbours overlapping anyway, so the whole cluster collapses to a
 * count and the tooltip carries the members.
 */
function groupByProximity(placed: readonly PlacedMarker[], widthPx: number): MarkerOverlayEntry[] {
  const entries: MarkerOverlayEntry[] = [];
  let cluster: PlacedMarker[] = [];

  const flush = (): void => {
    if (cluster.length === 0) return;
    entries.push(...entriesForCluster(cluster));
    cluster = [];
  };

  for (const candidate of placed) {
    const anchor = cluster[0];
    const apart = anchor ? Math.abs(candidate.xFraction - anchor.xFraction) * widthPx : 0;
    if (anchor && apart > PROXIMITY_TOLERANCE_PX) flush();
    cluster.push(candidate);
  }
  flush();
  return entries;
}

function entriesForCluster(cluster: readonly PlacedMarker[]): MarkerOverlayEntry[] {
  const sameDate = cluster.every((entry) => entry.xFraction === cluster[0]?.xFraction);
  if (cluster.length === 1 || sameDate) {
    return cluster.map((placed, stackIndex) => ({
      id: `${placed.marker.calendarId}|${placed.marker.date}|${stackIndex}`,
      xFraction: placed.xFraction,
      label: labelOf(placed.marker),
      title: titleOf(placed.marker),
      color: safeColor(placed.marker.color),
      stackIndex,
      groupedCount: 1,
      isToday: false,
    }));
  }

  const first = cluster[0]!;
  return [
    {
      id: `group|${first.marker.date}|${cluster.length}`,
      xFraction: first.xFraction,
      label: `${cluster.length} markers`,
      title: cluster.map((placed) => titleOf(placed.marker)).join('\n'),
      color: safeColor(first.marker.color),
      stackIndex: 0,
      groupedCount: cluster.length,
      isToday: false,
    },
  ];
}

function placeToday(
  today: Date | null,
  span: OverlaySpan,
  total: number,
): MarkerOverlayEntry | null {
  if (today === null) return null;
  const offset = span.diff(today, span.start, span.lengthUnit);
  if (!Number.isFinite(offset) || offset < 0 || offset > total) return null;
  return {
    id: TODAY_MARKER_ID,
    xFraction: offset / total,
    label: 'Today',
    title: 'Today',
    color: 'var(--text-accent)',
    stackIndex: 0,
    groupedCount: 1,
    isToday: true,
  };
}

function labelOf(marker: MarkerInput): string {
  return marker.name ?? marker.date;
}

function titleOf(marker: MarkerInput): string {
  return `${labelOf(marker)} — ${marker.calendarName}`;
}

function safeColor(color: string | undefined): string {
  return isSafeColor(color) ? (color as string) : DEFAULT_MARKER_COLOR;
}

function isoToLocalDate(iso: string): Date | null {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = parts as [number, number, number];
  return new Date(year, month - 1, day);
}
