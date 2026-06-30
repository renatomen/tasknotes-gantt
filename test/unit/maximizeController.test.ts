import { createMaximizeController } from '../../src/bases/maximizeController';

/**
 * Maximize state machine (plan 2026-06-30-002 U1). Pure, DOM-free: the Escape
 * source is injected so this runs under the node Jest env (mirrors the DI in
 * readinessController / basesConfigRefresh). The Svelte component owns the real
 * `document` keydown registration and the CSS class toggle; this module owns
 * only enter/exit/toggle, Esc-to-exit-while-maximized, and idempotent teardown.
 */

/** A fake Escape registrar: records the handler + unregister calls so a test can
 *  fire Esc on demand without a real `document`. */
function makeFakeEscapeSource() {
  let handler: (() => void) | null = null;
  let unregisterCount = 0;
  return {
    /** Matches the controller's `registerEscape: (onEscape) => unregister`. */
    register: (onEscape: () => void): (() => void) => {
      handler = onEscape;
      return () => {
        unregisterCount += 1;
        handler = null;
      };
    },
    fireEscape: () => handler?.(),
    hasHandler: () => handler !== null,
    unregisterCount: () => unregisterCount,
  };
}

describe('createMaximizeController (plan 002 U1)', () => {
  it('toggle() flips state false→true→false and notifies onChange each time', () => {
    const changes: boolean[] = [];
    const ctrl = createMaximizeController({
      onChange: (v) => changes.push(v),
      registerEscape: makeFakeEscapeSource().register,
    });

    expect(ctrl.isMaximized()).toBe(false);
    ctrl.toggle();
    expect(ctrl.isMaximized()).toBe(true);
    ctrl.toggle();
    expect(ctrl.isMaximized()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('Esc exits only when maximized; Esc while embedded is a no-op (Covers AE3 at state level)', () => {
    const changes: boolean[] = [];
    const esc = makeFakeEscapeSource();
    const ctrl = createMaximizeController({
      onChange: (v) => changes.push(v),
      registerEscape: esc.register,
    });

    // Embedded: firing Escape changes nothing.
    esc.fireEscape();
    expect(ctrl.isMaximized()).toBe(false);
    expect(changes).toEqual([]);

    // Maximized: Escape exits.
    ctrl.enter();
    esc.fireEscape();
    expect(ctrl.isMaximized()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('enter() and exit() are idempotent (no duplicate notifications)', () => {
    const changes: boolean[] = [];
    const ctrl = createMaximizeController({
      onChange: (v) => changes.push(v),
      registerEscape: makeFakeEscapeSource().register,
    });

    ctrl.enter();
    ctrl.enter(); // already maximized → no-op
    ctrl.exit();
    ctrl.exit(); // already embedded → no-op
    expect(changes).toEqual([true, false]);
  });

  it('destroy() unregisters the Escape listener exactly once and is idempotent', () => {
    const esc = makeFakeEscapeSource();
    const ctrl = createMaximizeController({
      onChange: () => { /* */ },
      registerEscape: esc.register,
    });

    expect(esc.hasHandler()).toBe(true); // registered at construction via the injected source
    ctrl.destroy();
    ctrl.destroy(); // idempotent
    expect(esc.unregisterCount()).toBe(1);
    expect(esc.hasHandler()).toBe(false);
  });

  it('ignores enter()/toggle() after destroy() and never throws', () => {
    const changes: boolean[] = [];
    const ctrl = createMaximizeController({
      onChange: (v) => changes.push(v),
      registerEscape: makeFakeEscapeSource().register,
    });

    ctrl.destroy();
    expect(() => {
      ctrl.enter();
      ctrl.toggle();
      ctrl.exit();
    }).not.toThrow();
    expect(ctrl.isMaximized()).toBe(false);
    expect(changes).toEqual([]);
  });
});
