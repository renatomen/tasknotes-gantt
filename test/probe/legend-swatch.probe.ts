/**
 * Renders the real GanttLegend over the real catalogue and screenshots it, so a
 * swatch's paint is seen, not inferred from computed style.
 */
/* global getComputedStyle */
import { test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import GanttLegend from '../../src/bases/GanttLegend.svelte';
import { buildLegendCatalog } from '../../src/bases/legendCatalog';
import type { GanttLegendContext } from '../../src/bases/types/gantt-view-data';

const CONTEXT: GanttLegendContext = {
  taskNotesPresent: false,
  barFillSource: 'default',
  barStripSource: 'none',
  barIconSource: 'none',
  statusColors: [],
  priorityColors: [],
  calendarPalette: [],
  calendarMarkerColor: undefined,
  hasRecordedRecurringOccurrences: false,
  showDateIndicators: true,
  hasNonAuthoredEdges: true,
  calendarEventColor: null,
  externalOccurrenceColor: null,
  estimateMeaning: 'calendar-days',
  nonWorkingRendering: 'shaded',
  calendarItems: { showRecurring: false },
  externalCalendarsEnabled: false,
};

async function mountLegend(overrides: Partial<GanttLegendContext> = {}): Promise<void> {
  render(GanttLegend, {
    props: {
      groups: buildLegendCatalog({ ...CONTEXT, ...overrides }),
      layout: 'right' as const,
      position: 'right' as const,
      onPositionChange: () => {},
      onDismiss: () => {},
    },
  });
  await new Promise((s) => setTimeout(s, 300));
}

async function scrollToEntry(semanticId: string): Promise<HTMLElement> {
  const entry = document.querySelector(`[data-semantic-id="${semanticId}"]`) as HTMLElement;
  expect(entry, `${semanticId} legend entry not rendered`).not.toBeNull();
  entry.scrollIntoView({ block: 'center' });
  await new Promise((s) => setTimeout(s, 200));
  return entry;
}

test('the torn-edge legend swatch renders with teeth cut into both edges', async () => {
  // A strip source too, so the sample carries the representative treatment the
  // torn cue composes with on real bars.
  await mountLegend({
    barStripSource: 'priority',
    priorityColors: [{ value: 'High', color: '#f97316' }],
  });
  const entry = await scrollToEntry('date-status-torn');

  const bar = entry.querySelector('.og-legend-bar') as HTMLElement;
  const style = getComputedStyle(bar);
  const mask = style.maskImage || style.webkitMaskImage;
  // One teeth tile per edge plus the solid middle — the production layer model.
  expect(mask.split('conic-gradient(').length - 1).toBe(2);
  expect(mask).toContain('linear-gradient');
  // The torn sides shed their radius as production bars do.
  expect(style.borderRadius).toBe('0px');
  // The strip accent starts past the leading teeth instead of painting over them.
  expect(getComputedStyle(bar, '::before').left).toBe('4px');

  await page.screenshot({ path: '__screenshots__/legend-torn-edge.png' });
});

test('the shading swatches render day cells with a shaded middle band', async () => {
  await mountLegend();
  const entry = await scrollToEntry('weekend-shading');

  const strip = entry.querySelector('.og-legend-shading') as HTMLElement;
  const image = getComputedStyle(strip).backgroundImage;
  expect(image).toContain('repeating-linear-gradient');
  // The band is a SECOND layer — 'repeating-linear-gradient' already contains
  // the substring 'linear-gradient', so assert the layer separator instead.
  expect(image).toContain('), linear-gradient(');

  await page.screenshot({ path: '__screenshots__/legend-shading-swatch.png' });
});
