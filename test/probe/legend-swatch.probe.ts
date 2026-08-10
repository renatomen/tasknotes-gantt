/**
 * Renders the real GanttLegend over the real catalogue and screenshots it, so a
 * swatch's paint is seen, not inferred from computed style. Pins the torn-edge
 * sample: its mask must actually cut the teeth tile into the bar.
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
  calendarEventColor: null,
  externalOccurrenceColor: null,
  estimateMeaning: 'calendar-days',
  nonWorkingRendering: 'shaded',
  calendarItems: { showRecurring: false },
  externalCalendarsEnabled: false,
};

test('the torn-edge legend swatch renders with the teeth cut into it', async () => {
  render(GanttLegend, {
    props: {
      groups: buildLegendCatalog(CONTEXT),
      layout: 'right' as const,
      position: 'right' as const,
      onPositionChange: () => {},
      onDismiss: () => {},
    },
  });
  await new Promise((s) => setTimeout(s, 300));

  const entry = document.querySelector('[data-semantic-id="date-status-torn"]') as HTMLElement;
  expect(entry, 'torn-edge legend entry not rendered').not.toBeNull();
  entry.scrollIntoView({ block: 'center' });

  const bar = entry.querySelector('.og-legend-bar') as HTMLElement;
  const mask = getComputedStyle(bar).maskImage || getComputedStyle(bar).webkitMaskImage;
  expect(mask).toContain('conic-gradient');

  await page.screenshot({ path: '__screenshots__/legend-torn-edge.png' });

  const weekend = document.querySelector('[data-semantic-id="weekend-shading"]') as HTMLElement;
  expect(weekend, 'weekend legend entry not rendered').not.toBeNull();
  weekend.scrollIntoView({ block: 'center' });
  await new Promise((s2) => setTimeout(s2, 200));
  const strip = weekend.querySelector('.og-legend-shading') as HTMLElement;
  expect(getComputedStyle(strip).backgroundImage).toContain('repeating-linear-gradient');
  await page.screenshot({ path: '__screenshots__/legend-shading-swatch.png' });
});
