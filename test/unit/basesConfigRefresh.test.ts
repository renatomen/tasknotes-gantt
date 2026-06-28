import { installBasesConfigRefreshHook } from '../../src/bases/basesConfigRefresh';

/**
 * #161 config-settle hook (ported from TaskNotes). Wraps the Bases controller's
 * `onConfigChanged` so the view refreshes ONCE after the change settles (its
 * returned promise resolves), and signals change-start so the view can suppress
 * the oscillating `onDataUpdated` burst meanwhile.
 */
describe('installBasesConfigRefreshHook (#161 config-settle)', () => {
  const noopSchedule = (cb: () => void, _ms: number) => cb();

  it('returns null when the controller has no onConfigChanged (old Bases)', () => {
    const cleanup = installBasesConfigRefreshHook({
      controller: {},
      view: {},
      isConnected: () => true,
      onSettled: () => { /* */ },
      scheduleTimeout: noopSchedule,
    });
    expect(cleanup).toBeNull();
  });

  it('calls onChangeStart synchronously and onSettled after the result promise resolves', async () => {
    const order: string[] = [];
    let resolveReload: () => void = () => { /* */ };
    const reload = new Promise<void>((res) => { resolveReload = res; });
    const controller: Record<string, unknown> = {
      onConfigChanged: () => { order.push('original'); return reload; },
    };
    installBasesConfigRefreshHook({
      controller,
      view: controller, // controller.view is undefined → "current view" passes
      isConnected: () => true,
      onChangeStart: () => order.push('start'),
      onSettled: () => order.push('settled'),
      scheduleTimeout: noopSchedule,
    });

    (controller.onConfigChanged as () => unknown)();
    // start + original run synchronously; settled waits for the promise.
    expect(order).toEqual(['start', 'original']);

    resolveReload();
    await reload;
    await Promise.resolve(); // flush the .then microtask
    expect(order).toEqual(['start', 'original', 'settled']);
  });

  it('settles via scheduleTimeout when onConfigChanged returns a non-promise', () => {
    const settled: string[] = [];
    const controller: Record<string, unknown> = { onConfigChanged: () => undefined };
    installBasesConfigRefreshHook({
      controller,
      view: controller,
      isConnected: () => true,
      onSettled: () => settled.push('settled'),
      scheduleTimeout: noopSchedule, // runs the callback immediately
    });
    (controller.onConfigChanged as () => unknown)();
    expect(settled).toEqual(['settled']);
  });

  it('does NOT settle-refresh when the view is disconnected', () => {
    const settled: string[] = [];
    const controller: Record<string, unknown> = { onConfigChanged: () => undefined };
    installBasesConfigRefreshHook({
      controller,
      view: controller,
      isConnected: () => false,
      onSettled: () => settled.push('settled'),
      scheduleTimeout: noopSchedule,
    });
    (controller.onConfigChanged as () => unknown)();
    expect(settled).toEqual([]);
  });

  it('does NOT settle-refresh when Bases switched the controller to another view', () => {
    const settled: string[] = [];
    const controller: Record<string, unknown> = {
      onConfigChanged: () => undefined,
      view: { other: true }, // controller.view !== our view
    };
    installBasesConfigRefreshHook({
      controller,
      view: { mine: true },
      isConnected: () => true,
      onSettled: () => settled.push('settled'),
      scheduleTimeout: noopSchedule,
    });
    (controller.onConfigChanged as () => unknown)();
    expect(settled).toEqual([]);
  });

  it('cleanup restores the original onConfigChanged', () => {
    const original = () => 'original';
    const controller: Record<string, unknown> = { onConfigChanged: original };
    const cleanup = installBasesConfigRefreshHook({
      controller,
      view: controller,
      isConnected: () => true,
      onSettled: () => { /* */ },
      scheduleTimeout: noopSchedule,
    });
    expect(controller.onConfigChanged).not.toBe(original);
    cleanup?.();
    expect(controller.onConfigChanged).toBe(original);
  });
});
