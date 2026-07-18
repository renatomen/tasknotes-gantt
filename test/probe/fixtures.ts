/**
 * Hardcoded probe fixtures (spike). Each ProbeCase feeds the raw SVAR <Gantt>
 * the minimal input + config a "Pro"-documented feature expects, plus the
 * candidate CSS hooks whose presence in the DOM means SVAR drew it. Exact
 * selectors are verified empirically by the probe run; `hooks` lists documented
 * candidates and `classKeyword` is a fallback regex over element class names.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const d = (day: number): Date => new Date(2026, 3, day); // April 2026

export interface ProbeCase {
  key: string;
  tasks: any[];
  links?: any[];
  /** Feature-enabling <Gantt> props, passed explicitly by name (no spread). */
  props?: {
    splitTasks?: boolean;
    markers?: any[];
    baselines?: boolean;
    rollups?: any;
    criticalPath?: any;
    slack?: boolean;
  };
  /** Documented candidate selectors; ANY match => feature rendered. */
  hooks: string[];
  /** Fallback: element whose className contains this keyword => likely rendered. */
  classKeyword?: string;
}

/** Harness sanity: a plain task must draw a bar. */
export const PLAIN: ProbeCase = {
  key: 'plain',
  tasks: [{ id: 1, text: 'Plain', type: 'task', start: d(2), end: d(10) }],
  hooks: ['.wx-bar'],
};

/** Split task WITH the splitTasks config flag. */
export const SEGMENTS_WITH_FLAG: ProbeCase = {
  key: 'segments+splitTasks',
  tasks: [
    {
      id: 1,
      text: 'Split',
      type: 'task',
      start: d(2),
      end: d(20),
      segments: [
        { start: d(2), end: d(6) },
        { start: d(14), end: d(20) },
      ],
    },
  ],
  props: { splitTasks: true },
  hooks: ['.wx-segment', '.wx-segments', '.wx-split'],
  classKeyword: 'segment',
};

/** Same segments WITHOUT the flag — does the flag gate rendering? */
export const SEGMENTS_NO_FLAG: ProbeCase = {
  key: 'segments-noflag',
  tasks: [
    {
      id: 1,
      text: 'Split',
      type: 'task',
      start: d(2),
      end: d(20),
      segments: [
        { start: d(2), end: d(6) },
        { start: d(14), end: d(20) },
      ],
    },
  ],
  hooks: ['.wx-segment', '.wx-segments', '.wx-split'],
  classKeyword: 'segment',
};

export const MARKERS: ProbeCase = {
  key: 'markers',
  tasks: [{ id: 1, text: 'T', type: 'task', start: d(2), end: d(20) }],
  props: { markers: [{ start: d(10), text: 'Marker A' }] },
  hooks: ['.wx-marker', '.wx-marker-line'],
  classKeyword: 'marker',
};

export const BASELINES: ProbeCase = {
  key: 'baselines',
  tasks: [
    {
      id: 1,
      text: 'T',
      type: 'task',
      start: d(4),
      end: d(12),
      base_start: d(2),
      base_end: d(10),
    },
  ],
  props: { baselines: true },
  hooks: ['.wx-baseline'],
  classKeyword: 'baseline',
};

export const ROLLUPS: ProbeCase = {
  key: 'rollups',
  tasks: [
    { id: 1, text: 'Summary', type: 'summary', open: true },
    { id: 2, text: 'Child A', type: 'task', parent: 1, start: d(2), end: d(6), rollup: true },
    { id: 3, text: 'Child B', type: 'task', parent: 1, start: d(10), end: d(16), rollup: true },
  ],
  props: { rollups: { type: 'closest' } },
  hooks: ['.wx-rollup', '.wx-task-rollup', '.wx-summary-rollup'],
  classKeyword: 'rollup',
};

export const CRITICAL: ProbeCase = {
  key: 'criticalPath',
  tasks: [
    { id: 1, text: 'A', type: 'task', start: d(2), end: d(6) },
    { id: 2, text: 'B', type: 'task', start: d(6), end: d(12) },
  ],
  links: [{ id: 1, source: 1, target: 2, type: 'e2s' }],
  props: { criticalPath: { type: 'flexible' } },
  hooks: ['.wx-critical'],
  classKeyword: 'critical',
};

export const SLACK: ProbeCase = {
  key: 'slack',
  tasks: [
    { id: 1, text: 'A', type: 'task', start: d(2), end: d(6) },
    { id: 2, text: 'B', type: 'task', start: d(6), end: d(12) },
  ],
  links: [{ id: 1, source: 1, target: 2, type: 'e2s' }],
  props: { slack: true, criticalPath: { type: 'flexible' } },
  hooks: ['.wx-slack', '.wx-slack-task'],
  classKeyword: 'slack',
};

/** Battery in the order the results table reports them. */
export const BATTERY: ProbeCase[] = [
  SEGMENTS_WITH_FLAG,
  SEGMENTS_NO_FLAG,
  MARKERS,
  BASELINES,
  ROLLUPS,
  CRITICAL,
  SLACK,
];
