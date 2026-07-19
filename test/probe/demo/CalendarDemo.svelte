<!--
  DECISION SKETCH — disposable. Renders one identical task under four
  calendar-aware bar treatments so the shapes can be compared directly.
  Judge the SHAPE and readability, not the exact colours or spacing.
-->
<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { Gantt, Willow, WillowDark } from '@svar-ui/svelte-gantt';
  import CalendarBar from './CalendarBar.svelte';
  import {
    isNonWorking,
    workingRuns,
    nonWorkingRuns,
    allRuns,
    type DemoCalendar,
  } from './calendarModel';
  import '../segments.css';

  const d = (m: number, day: number): Date => new Date(2026, m, day);

  /** Mon–Fri, with Good Friday 10 Apr as a holiday. */
  const cal: DemoCalendar = {
    name: 'Engineering',
    nonWorkingWeekdays: [6, 7],
    holidays: ['2026-04-10'],
  };

  // Thu 2 Apr through Tue 14 Apr (end is exclusive).
  const START = d(3, 2);
  const END = d(3, 15);

  let dark = $state(false);
  let cellWidth = $state(46);

  const working = workingRuns(START, END, cal);
  const nonWorking = nonWorkingRuns(START, END, cal);
  const runs = allRuns(START, END, cal);

  const row = (id: number, text: string, treatment: string, extra: any = {}) => ({
    id,
    text,
    type: 'task',
    start: START,
    end: END,
    treatment,
    ...extra,
  });

  const tasks: any[] = [
    row(1, 'A — split at non-working gaps', 'split', { segments: working }),
    row(2, 'B — hatched through', 'hatched', { nonWorking }),
    row(3, 'C — faded through', 'faded', { nonWorking }),
    row(4, 'D — bar untouched (background only)', 'plain'),
    row(5, 'E — ghosted 30% (grid reads through)', 'ghosted', { runs, ghostOpacity: 0.3 }),
    row(6, 'F — ghosted 15% (barely there)', 'ghosted', { runs, ghostOpacity: 0.15 }),
  ];

  const columns = [{ id: 'text', header: 'Treatment', flexgrow: 2 }];

  /** The shading half — already possible today via the non-gated highlightTime. */
  const highlightTime = (date: Date, unit: string): string =>
    unit === 'day' && isNonWorking(date, cal) ? 'wx-weekend' : '';
</script>

<div class="page" class:dark>
  <header>
    <h1>Calendar-aware bars — decision sketch</h1>
    <p>
      One identical task (Thu 2 Apr → Tue 14 Apr) on a <strong>Mon–Fri calendar with
      Fri 10 Apr as a holiday</strong>, rendered six ways. The timeline background
      shading is the same in every row — that half is settled. <strong>Judge only what
      the bar itself does</strong> where it crosses non-working time; ignore exact
      colours, hatch density and spacing.
    </p>
    <p class="legend">
      Non-working in this window: Sat 4–Sun 5, and Fri 10 (holiday) + Sat 11–Sun 12,
      which merge into one three-day gap.
    </p>
    <div class="controls">
      <label><input type="checkbox" bind:checked={dark} /> Dark theme</label>
      <label>Zoom <input type="range" min="24" max="90" bind:value={cellWidth} /> {cellWidth}px</label>
    </div>
  </header>

  <div class="chart">
    {#if dark}
      <WillowDark>
        <Gantt {tasks} {columns} {cellWidth} {highlightTime} taskTemplate={CalendarBar} readonly />
      </WillowDark>
    {:else}
      <Willow>
        <Gantt {tasks} {columns} {cellWidth} {highlightTime} taskTemplate={CalendarBar} readonly />
      </Willow>
    {/if}
  </div>

  <footer>
    <p>
      A reuses the split-task renderer already proved in <code>test/probe/</code>.
      B, C and E keep one continuous bar and style the non-working stretches instead —
      B with texture, C with an opaque wash, E at 30% so the background grid reads
      through. D changes nothing about the bar.
    </p>
  </footer>
</div>

<style>
  .page {
    font-family: system-ui, sans-serif;
    padding: 20px;
    min-height: 100vh;
    box-sizing: border-box;
    background: #fff;
    color: #16233a;
  }
  .page.dark { background: #1b1d21; color: #e6e6e6; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  p { margin: 0 0 10px; max-width: 78ch; font-size: 13px; line-height: 1.5; opacity: 0.88; }
  .legend { font-size: 12.5px; opacity: 0.72; }
  .controls { display: flex; gap: 24px; align-items: center; font-size: 13px; margin: 14px 0; }
  .chart {
    height: 340px;
    border: 1px solid rgba(128,128,128,0.35);
    border-radius: 6px;
    overflow: hidden;
  }
  footer p { margin-top: 12px; font-size: 12.5px; opacity: 0.7; }

  /* Make non-working shading visible in the chart body, not just the scale. */
  :global(.wx-cell.wx-weekend) { background: rgba(128, 140, 160, 0.16); }
</style>
