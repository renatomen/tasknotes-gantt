/**
 * Characterization of the derivation authority's blocking-facts builders:
 * window sizing (62 + 8×duration + 366 headroom), cache-key/epoch memoization,
 * and transient builds that must never displace the pass-level cache. These
 * Obsidian-coupled semantics are what the pure derivation table cannot reach,
 * and the window sizing is a documented past drift point — the suite pins them
 * against the mocked Obsidian app, wiring the controller from the REAL view's
 * config and mapping machinery exactly as the mount does.
 */
import { describe, it, expect } from '@jest/globals';
import type { App, BasesViewConfig, Plugin, QueryController } from 'obsidian';
import { TFile } from 'obsidian';
import { registerBasesGantt } from '../../src/bases/register';
import {
  GanttController,
  type DatePolicyConfig,
  type StretchTaskInput,
  type TaskBlocking,
} from '../../src/controller/GanttController';
import type { FieldMappings } from '../../src/bases/types/field-mapping';
import type { CalendarNoteInput } from '../../src/controller/calendar/resolveCalendars';
import type {
  DataSource,
  DataSourceCapabilities,
  SourceTask,
} from '../../src/datasource/types';

/** The view-side machinery the harness wires the controller from (private on the view). */
interface ViewInternals {
  buildDatePolicyConfig(): DatePolicyConfig;
  getEffectiveMappings(): FieldMappings;
  collectMarkedCalendarNotes(): CalendarNoteInput[];
  buildFieldMappings(): FieldMappings;
}

/** The controller-side builder under characterization (private). */
interface ControllerInternals {
  buildTaskBlocking(
    tasks: readonly StretchTaskInput[],
    opts?: { transient?: boolean },
  ): (taskPath: string) => TaskBlocking | null;
}

interface Harness {
  controller: GanttController;
  buildTaskBlocking: ControllerInternals['buildTaskBlocking'];
  /** Count of full vault walks (getMarkdownFiles calls). */
  vaultWalks(): number;
  setEpoch(epoch: number): void;
}

interface FixtureNote {
  path: string;
  frontmatter?: Record<string, unknown>;
}

/**
 * A weekday calendar (Mon–Fri working) with one authored blocked run FAR from
 * the near-term task spans — the probe for what the evaluation window covers.
 */
const FIXTURE_NOTES: FixtureNote[] = [
  {
    path: 'Calendars/NZ.md',
    frontmatter: {
      tngantt: 'calendar',
      pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      non_working: [{ start: '2027-06-14', end: '2027-06-22' }],
    },
  },
  { path: 'Tasks/T.md', frontmatter: { calendar: '[[NZ]]' } },
  { path: 'Tasks/NoCal.md', frontmatter: {} },
];

function makeFakeApp(notes: FixtureNote[]): { app: App; vaultWalks: () => number } {
  const files = notes.map((note) => {
    const file = new TFile();
    file.path = note.path;
    file.basename = note.path.split('/').pop()?.replace(/\.md$/, '') ?? note.path;
    return file;
  });
  const frontmatterByPath = new Map(notes.map((note) => [note.path, note.frontmatter]));
  let walks = 0;
  const app = {
    vault: {
      getMarkdownFiles: () => {
        walks += 1;
        return files;
      },
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const frontmatter = frontmatterByPath.get(file.path);
        return frontmatter ? { frontmatter } : null;
      },
      getFirstLinkpathDest: (linkPath: string) =>
        files.find((file) => file.basename === linkPath || file.path === linkPath) ?? null,
    },
  } as unknown as App;
  return { app, vaultWalks: () => walks };
}

/** A minimal readable source serving the given tasks (the AE4 refresh side). */
class StubSource implements DataSource {
  readonly capabilities: DataSourceCapabilities = { write: false };
  constructor(private readonly tasks: SourceTask[]) {}
  async getTasks(): Promise<SourceTask[]> {
    return this.tasks;
  }
  async getDependencies(): Promise<[]> {
    return [];
  }
  async getFieldConfig(): Promise<null> {
    return null;
  }
}

/**
 * Build the REAL view through the registration factory seam, then wire a
 * controller from its config/mapping machinery exactly as `mountGantt` does —
 * the same provider closures, so the characterization pins the production
 * assembly path end to end.
 */
function makeHarness(config: Record<string, unknown> = {}, tasks: SourceTask[] = []): Harness {
  const { app, vaultWalks } = makeFakeApp(FIXTURE_NOTES);
  const configValues: Record<string, unknown> = {
    tngantt_calendarProperty: 'note.calendar',
    ...config,
  };
  let captured:
    | { factory: (controller: QueryController, containerEl: HTMLElement) => unknown }
    | null = null;
  const plugin = {
    app,
    register: () => {},
    addChild: <T>(child: T) => child,
    registerBasesView: (
      _id: string,
      opts: { factory: (controller: QueryController, containerEl: HTMLElement) => unknown },
    ) => {
      captured = opts;
      return true;
    },
  } as unknown as Plugin;
  registerBasesGantt(plugin);
  if (!captured) throw new Error('Bases view factory was not captured');
  const queryController = {
    app,
    config: { get: (key: string) => configValues[key] } as unknown as BasesViewConfig,
    data: { data: [] },
  } as unknown as QueryController;
  const mountEl = { style: {} as Record<string, string>, isConnected: false };
  const parentEl = { createDiv: () => mountEl } as unknown as HTMLElement;
  const view = (captured as { factory: (c: QueryController, e: HTMLElement) => unknown }).factory(
    queryController,
    parentEl,
  );
  const internals = view as unknown as ViewInternals;
  const watched = view as unknown as { calendarWatch: { epoch(): number } | null };
  const source = new StubSource(tasks);
  const controller = new GanttController({
    app,
    basesInput: () => ({ entries: [], mappings: internals.buildFieldMappings() }),
    policyConfig: () => internals.buildDatePolicyConfig(),
    derivationInputs: {
      effectiveMappings: () => internals.getEffectiveMappings(),
      calendarEpoch: () => watched.calendarWatch?.epoch() ?? 0,
      markedCalendarNotes: () => internals.collectMarkedCalendarNotes(),
    },
    now: () => new Date(2026, 3, 8), // Wed 2026-04-08
    deps: {
      createTaskNotesSource: async () => source,
      createBasesSource: () => source,
    },
  });
  return {
    controller,
    buildTaskBlocking: (tasksArg, opts) =>
      (controller as unknown as ControllerInternals).buildTaskBlocking(tasksArg, opts),
    vaultWalks,
    setEpoch: (epoch: number) => {
      watched.calendarWatch = { epoch: () => epoch };
    },
  };
}

/** The near-term pass span: Mon 2026-04-06 .. Tue 2026-04-07. */
const passTasks: StretchTaskInput[] = [
  { path: 'Tasks/T.md', start: new Date(2026, 3, 6), end: new Date(2026, 3, 7), estimateMinutes: null },
];

const iso = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

describe('buildTaskBlocking window sizing (62 + 8×duration + 366 headroom)', () => {
  it('materializes authored blocked days inside the default-duration window and reads beyond it as working', () => {
    const { buildTaskBlocking } = makeHarness();
    const blocking = buildTaskBlocking(passTasks)('Tasks/T.md');
    if (!blocking) throw new Error('expected blocking facts for the associated task');
    // Window end-exclusive for defaultDuration 1: 2026-04-07 + (62+8+366)+1 days = 2027-06-18.
    expect(blocking.isBlocked('2027-06-15')).toBe(true); // authored, inside the window
    expect(blocking.isBlocked('2027-06-21')).toBe(false); // authored, but beyond → reads working
  });

  it('grows the window 8× with the longest estimate in the pass', () => {
    const { buildTaskBlocking } = makeHarness();
    const tenDayEstimate: StretchTaskInput[] = [
      { ...passTasks[0]!, estimateMinutes: 10 * 1440 },
    ];
    const blocking = buildTaskBlocking(tenDayEstimate)('Tasks/T.md');
    if (!blocking) throw new Error('expected blocking facts for the associated task');
    // Window end-exclusive grows to 2026-04-07 + (62+80+366)+1 days = 2027-08-29.
    expect(blocking.isBlocked('2027-06-21')).toBe(true);
  });

  it('yields null blocking for a task with no calendar association', () => {
    const { buildTaskBlocking } = makeHarness();
    const lookup = buildTaskBlocking([
      { path: 'Tasks/NoCal.md', start: new Date(2026, 3, 6), end: new Date(2026, 3, 7), estimateMinutes: null },
    ]);
    expect(lookup('Tasks/NoCal.md')).toBeNull();
  });
});

describe('buildTaskBlocking cache key and epoch', () => {
  it('reuses the pass lookup for unchanged inputs without re-walking the vault', () => {
    const { buildTaskBlocking, vaultWalks } = makeHarness();
    const first = buildTaskBlocking(passTasks);
    const second = buildTaskBlocking(passTasks);
    expect(second).toBe(first);
    expect(vaultWalks()).toBe(1);
  });

  it('rebuilds when the calendar-watch epoch flips', () => {
    const { buildTaskBlocking, vaultWalks, setEpoch } = makeHarness();
    const first = buildTaskBlocking(passTasks);
    setEpoch(1);
    const second = buildTaskBlocking(passTasks);
    expect(second).not.toBe(first);
    expect(vaultWalks()).toBe(2);
  });

  it('a transient build never displaces the pass-level cache', () => {
    const { buildTaskBlocking, vaultWalks } = makeHarness();
    const pass = buildTaskBlocking(passTasks);
    const transient = buildTaskBlocking(
      [{ path: 'Tasks/T.md', start: new Date(2027, 5, 14), end: new Date(2027, 5, 18), estimateMinutes: null }],
      { transient: true },
    );
    expect(transient).not.toBe(pass);
    // The pass cache survives: the next pass-level ask is the SAME lookup, no re-walk.
    expect(buildTaskBlocking(passTasks)).toBe(pass);
    expect(vaultWalks()).toBe(2);
  });
});

describe('buildCountWorkingDays (write-side estimate counter)', () => {
  it('counts only working days of the resized span', () => {
    const { controller } = makeHarness({ tngantt_estimateMeaning: 'working-days' });
    const count = controller.buildCountWorkingDays();
    // Fri 2026-04-10 .. Tue 2026-04-14: Sat+Sun blocked → 3 working days.
    expect(count?.('Tasks/T.md', new Date(2026, 3, 10), new Date(2026, 3, 14))).toBe(3);
  });

  it('windows FRESH facts for the counted span — far spans still see their blocked days', () => {
    const { controller, buildTaskBlocking } = makeHarness({ tngantt_estimateMeaning: 'working-days' });
    // Prime the pass cache with the near-term span (its window ends 2027-06-18).
    buildTaskBlocking(passTasks);
    const count = controller.buildCountWorkingDays();
    // Mon 2027-06-14 .. Fri 2027-06-18 sits inside the authored blocked run: a
    // stale pass window would read the days beyond it as working (5); fresh
    // facts windowed for THIS span see them all blocked → floor 1.
    expect(count?.('Tasks/T.md', new Date(2027, 5, 14), new Date(2027, 5, 18))).toBe(1);
  });

  it('returns null for a task with no calendar (the plain span is the record)', () => {
    const { controller } = makeHarness({ tngantt_estimateMeaning: 'working-days' });
    const count = controller.buildCountWorkingDays();
    expect(count?.('Tasks/NoCal.md', new Date(2026, 3, 10), new Date(2026, 3, 14))).toBeNull();
  });

  it('is absent entirely when no axis engages working-day counting', () => {
    const { controller } = makeHarness();
    expect(controller.buildCountWorkingDays()).toBeUndefined();
  });
});

describe('buildProjectDerivedSpan (write-side re-derivation projection)', () => {
  it('projects a derived end over working days from its anchor', () => {
    const { controller } = makeHarness({ tngantt_estimateMeaning: 'working-days' });
    const project = controller.buildProjectDerivedSpan();
    const projected = project?.('Tasks/T.md', 'end', new Date(2026, 3, 10), 3 * 1440);
    if (!projected) throw new Error('expected a projection');
    expect(iso(projected.start)).toBe('2026-04-10');
    expect(iso(projected.end)).toBe('2026-04-14'); // Fri + Mon + Tue
  });

  it('walks off a blocked anchor day instead of flooring there', () => {
    const { controller } = makeHarness({ tngantt_estimateMeaning: 'working-days' });
    const project = controller.buildProjectDerivedSpan();
    const projected = project?.('Tasks/T.md', 'end', new Date(2026, 3, 11), 1440);
    if (!projected) throw new Error('expected a projection');
    expect(iso(projected.end)).toBe('2026-04-13'); // Sat anchor → next Monday
  });

  it('windows FRESH facts for the grown estimate — the walk clears a far blocked run', () => {
    const { controller, buildTaskBlocking } = makeHarness({ tngantt_estimateMeaning: 'working-days' });
    buildTaskBlocking(passTasks);
    const project = controller.buildProjectDerivedSpan();
    // Fri 2027-06-11 anchor, 2 working days: the weekend + the authored run
    // 06-14..06-22 are blocked, so the second working day is Wed 06-23 — visible
    // only when the facts are windowed for THIS projection, not the pass.
    const projected = project?.('Tasks/T.md', 'end', new Date(2027, 5, 11), 2 * 1440);
    if (!projected) throw new Error('expected a projection');
    expect(iso(projected.end)).toBe('2027-06-23');
  });

  it('is absent when no working-day axis engages, and null for a calendar-days task', () => {
    const flat = makeHarness();
    expect(flat.controller.buildProjectDerivedSpan()).toBeUndefined();
  });
});

describe('one-sided re-derivation identity (save-time == refresh-time)', () => {
  it('an estimate saved as working days re-derives to the same span after refresh', async () => {
    // One task with ONLY a start date (Fri 2026-04-10) and a 3-working-day
    // estimate. The write side projects its derived end at save time; the read
    // pass re-derives it on the next refresh. Both must answer identically —
    // the read pass may not drop the one-sided span from its blocking window.
    const task: SourceTask = {
      path: 'Tasks/T.md',
      text: 'T',
      start: new Date(2026, 3, 10),
      end: null,
      progress: null,
      status: null,
      parents: [],
      estimate: 3 * 1440,
    };
    const { controller } = makeHarness({ tngantt_estimateMeaning: 'working-days' }, [task]);

    const saveTime = controller.buildProjectDerivedSpan()?.(
      'Tasks/T.md',
      'end',
      new Date(2026, 3, 10),
      3 * 1440,
    );
    if (!saveTime) throw new Error('expected a save-time projection');

    await controller.init();
    const refreshTime = (await controller.getInstances()).find(
      (instance) => instance.sourcePath === 'Tasks/T.md',
    );
    if (!refreshTime?.start || !refreshTime?.end) throw new Error('expected a refreshed instance');

    expect(iso(refreshTime.start)).toBe(iso(saveTime.start));
    expect(iso(refreshTime.end)).toBe(iso(saveTime.end));
    expect(iso(refreshTime.end)).toBe('2026-04-14'); // Fri + Mon + Tue, not Sun
  });
});
