<!--
  Interactive spike demo: hand-rolled SVAR-style split-task rendering.
  Ctrl/Cmd + wheel over the chart to zoom and watch segment positions track.
-->
<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { Gantt, Willow, WillowDark } from '@svar-ui/svelte-gantt';
  import SegmentBar from '../SegmentBar.svelte';
  import '../segments.css';

  const d = (m: number, day: number): Date => new Date(2026, m, day);

  let dark = $state(false);
  let cellWidth = $state(36);

  const tasks: any[] = [
    {
      id: 1,
      text: 'Ordinary task (no segments)',
      type: 'task',
      start: d(3, 2),
      end: d(3, 12),
      progress: 60,
    },
    // A task's span should cover its segments — SVAR Pro guarantees this by
    // deriving the span from them. Here it is the author's job, so each `end`
    // below is the last segment's end.
    {
      id: 2,
      text: '8-week course — class every 2 weeks',
      type: 'task',
      start: d(3, 1),
      end: d(4, 28), // Class 5 starts May 27 and runs one day
      progress: 35,
      segments: [
        { start: d(3, 1), duration: 1, text: 'Class 1' },
        { start: d(3, 15), duration: 1, text: 'Class 2' },
        { start: d(3, 29), duration: 1, text: 'Class 3' },
        { start: d(4, 13), duration: 1, text: 'Class 4' },
        { start: d(4, 27), duration: 1, text: 'Class 5' },
      ],
    },
    {
      id: 3,
      text: 'Two work blocks with a gap',
      type: 'task',
      start: d(3, 2),
      end: d(3, 22), // Block 2 starts Apr 16 and runs six days
      progress: 40,
      segments: [
        { start: d(3, 2), duration: 4, text: 'Block 1' },
        { start: d(3, 16), duration: 6, text: 'Block 2' },
      ],
    },
    {
      id: 4,
      text: 'Uneven bursts, 70% done',
      type: 'task',
      start: d(3, 3),
      end: d(4, 6),
      progress: 70,
      segments: [
        { start: d(3, 3), duration: 2 },
        { start: d(3, 9), duration: 5 },
        { start: d(3, 20), duration: 3 },
        { start: d(4, 1), duration: 5 },
      ],
    },
  ];

  const columns = [
    { id: 'text', header: 'Task', flexgrow: 2 },
    { id: 'start', header: 'Start', align: 'center' as const, width: 110 },
  ];
</script>

<div class="page" class:dark>
  <header>
    <h1>Split-task segments — hand-rolled on the free SVAR build</h1>
    <p>
      Spaced sub-bars in a single row, drawn by a custom bar template. SVAR's own
      split-task is Pro-gated; this reproduces its DOM and look against the MIT
      build. <strong>Ctrl/Cmd + wheel</strong> over the chart to zoom — segment
      positions are computed from the live scale, so they track.
    </p>
    <div class="controls">
      <label><input type="checkbox" bind:checked={dark} /> Dark theme</label>
      <label>
        Cell width
        <input type="range" min="16" max="80" bind:value={cellWidth} />
        {cellWidth}px
      </label>
    </div>
  </header>

  <div class="chart">
    {#if dark}
      <WillowDark>
        <Gantt {tasks} {columns} {cellWidth} taskTemplate={SegmentBar} readonly zoom />
      </WillowDark>
    {:else}
      <Willow>
        <Gantt {tasks} {columns} {cellWidth} taskTemplate={SegmentBar} readonly zoom />
      </Willow>
    {/if}
  </div>
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
  .page.dark {
    background: #1b1d21;
    color: #e6e6e6;
  }
  h1 {
    font-size: 18px;
    margin: 0 0 6px;
  }
  p {
    margin: 0 0 12px;
    max-width: 70ch;
    font-size: 13px;
    line-height: 1.5;
    opacity: 0.85;
  }
  .controls {
    display: flex;
    gap: 24px;
    align-items: center;
    font-size: 13px;
    margin-bottom: 14px;
  }
  .chart {
    height: 340px;
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 6px;
    overflow: hidden;
  }
</style>
