import {
  createCalendarWatch,
  wireCalendarWatch,
  type CalendarWatch,
  type WatchEventSource,
} from '../../src/bases/calendarWatch';
import type { TimerScheduler } from '../../src/bases/scheduler';

interface FakeTimer {
  callback: () => void;
  cleared: boolean;
}

function fakeScheduler(): { scheduler: TimerScheduler; timers: FakeTimer[]; fireLast(): void } {
  const timers: FakeTimer[] = [];
  return {
    timers,
    scheduler: {
      setTimeout: (callback) => {
        const timer: FakeTimer = { callback, cleared: false };
        timers.push(timer);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (handle) => {
        const timer = timers[(handle as unknown as number) - 1];
        if (timer) timer.cleared = true;
      },
    },
    fireLast() {
      const live = timers.filter((timer) => !timer.cleared);
      live[live.length - 1]?.callback();
    },
  };
}

function watchWith(
  calendarPaths: string[],
): { watch: CalendarWatch; fired: number[]; fake: ReturnType<typeof fakeScheduler> } {
  const fake = fakeScheduler();
  const fired: number[] = [];
  const watch = createCalendarWatch({
    isCalendarNote: (path) => calendarPaths.includes(path),
    onReResolve: () => fired.push(1),
    scheduler: fake.scheduler,
    debounceMs: 500,
  });
  return { watch, fired, fake };
}

describe('createCalendarWatch', () => {
  it('fires exactly one re-resolve after the debounce despite rapid relevant events', () => {
    const { watch, fired, fake } = watchWith(['Calendars/NZ.md']);
    watch.notifyChanged('Calendars/NZ.md');
    watch.notifyChanged('Calendars/NZ.md');
    watch.notifyChanged('Calendars/NZ.md');
    expect(fired).toHaveLength(0);
    fake.fireLast();
    expect(fired).toHaveLength(1);
    expect(fake.timers.filter((timer) => !timer.cleared)).toHaveLength(1);
  });

  it('ignores a non-calendar note change', () => {
    const { watch, fired, fake } = watchWith(['Calendars/NZ.md']);
    watch.notifyChanged('Notes/Plain.md');
    expect(fake.timers).toHaveLength(0);
    expect(fired).toHaveLength(0);
    expect(watch.epoch()).toBe(0);
  });

  it('still triggers for a note that just lost its marker (previously known)', () => {
    const calendarPaths = ['Calendars/NZ.md'];
    const fake = fakeScheduler();
    const fired: number[] = [];
    const watch = createCalendarWatch({
      isCalendarNote: (path) => calendarPaths.includes(path),
      onReResolve: () => fired.push(1),
      scheduler: fake.scheduler,
      debounceMs: 500,
    });
    watch.notifyChanged('Calendars/NZ.md');
    calendarPaths.length = 0;
    watch.notifyChanged('Calendars/NZ.md');
    expect(watch.epoch()).toBe(2);
    // The demotion released the path: further edits to the now-plain note are
    // ignored (the reuse gate is not permanently defeated).
    watch.notifyChanged('Calendars/NZ.md');
    expect(watch.epoch()).toBe(2);
  });

  it('triggers on rename of a known calendar note (old path tracked)', () => {
    const { watch } = watchWith(['Calendars/NZ.md']);
    watch.notifyChanged('Calendars/NZ.md');
    watch.notifyRenamed('Calendars/NZ Renamed.md', 'Calendars/NZ.md');
    expect(watch.epoch()).toBe(2);
  });

  it('triggers on rename when the new path is a calendar note', () => {
    const { watch } = watchWith(['Calendars/New.md']);
    watch.notifyRenamed('Calendars/New.md', 'Old.md');
    expect(watch.epoch()).toBe(1);
  });

  it('triggers on delete of a known calendar note and ignores unknown deletes', () => {
    const { watch } = watchWith(['Calendars/NZ.md']);
    watch.notifyDeleted('Calendars/NZ.md');
    expect(watch.epoch()).toBe(0);
    watch.notifyChanged('Calendars/NZ.md');
    watch.notifyDeleted('Calendars/NZ.md');
    expect(watch.epoch()).toBe(2);
  });

  it('epoch counts relevant events monotonically', () => {
    const { watch } = watchWith(['Calendars/NZ.md']);
    watch.notifyChanged('Calendars/NZ.md');
    watch.notifyChanged('Notes/Plain.md');
    watch.notifyChanged('Calendars/NZ.md');
    expect(watch.epoch()).toBe(2);
  });

  it('dispose cancels the pending timer and stops future scheduling', () => {
    const { watch, fired, fake } = watchWith(['Calendars/NZ.md']);
    watch.notifyChanged('Calendars/NZ.md');
    watch.dispose();
    expect(fake.timers[0]?.cleared).toBe(true);
    watch.notifyChanged('Calendars/NZ.md');
    expect(fake.timers).toHaveLength(1);
    expect(fired).toHaveLength(0);
  });
});

describe('wireCalendarWatch', () => {
  interface Registration {
    source: 'metadataCache' | 'vault';
    event: string;
  }

  function fakeSource(
    label: Registration['source'],
    registrations: Registration[],
    offed: unknown[],
  ): WatchEventSource {
    return {
      on: (name) => {
        registrations.push({ source: label, event: name });
        return { source: label, event: name };
      },
      offref: (ref) => offed.push(ref),
    };
  }

  it('subscribes the exact event sources and names: cache changed, vault rename/delete', () => {
    const registrations: Registration[] = [];
    const offed: unknown[] = [];
    const { watch } = watchWith([]);
    wireCalendarWatch(
      {
        metadataCache: fakeSource('metadataCache', registrations, offed),
        vault: fakeSource('vault', registrations, offed),
      },
      watch,
    );
    expect(registrations).toEqual([
      { source: 'metadataCache', event: 'changed' },
      { source: 'vault', event: 'rename' },
      { source: 'vault', event: 'delete' },
    ]);
  });

  it('unsubscribes every registration on unwire', () => {
    const registrations: Registration[] = [];
    const offed: unknown[] = [];
    const { watch } = watchWith([]);
    const unwire = wireCalendarWatch(
      {
        metadataCache: fakeSource('metadataCache', registrations, offed),
        vault: fakeSource('vault', registrations, offed),
      },
      watch,
    );
    unwire();
    expect(offed).toHaveLength(3);
  });
});
