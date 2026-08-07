import { describe, expect, it } from '@jest/globals';
import {
  CLOSED_LEGEND_SESSION,
  MIN_BOTTOM_OVERLAY_HOST_HEIGHT,
  MIN_BOTTOM_OVERLAY_HOST_WIDTH,
  MIN_RIGHT_OVERLAY_HOST_HEIGHT,
  MIN_RIGHT_OVERLAY_HOST_WIDTH,
  reduceLegendSession,
  resolveLegendLayout,
} from '../../src/bases/legendLayout';

describe('legend session position', () => {
  it('switches position only for the current opening and re-reads the default after close', () => {
    const opened = reduceLegendSession(CLOSED_LEGEND_SESSION, {
      type: 'open',
      defaultPosition: 'right',
    });
    const moved = reduceLegendSession(opened, { type: 'move', position: 'bottom' });
    const closed = reduceLegendSession(moved, { type: 'close' });
    const reopened = reduceLegendSession(closed, { type: 'open', defaultPosition: 'right' });

    expect(opened).toEqual({ open: true, position: 'right' });
    expect(moved).toEqual({ open: true, position: 'bottom' });
    expect(closed).toEqual({ open: false });
    expect(reopened).toEqual({ open: true, position: 'right' });
  });

  it('applies a changed setting to the next opening without changing the open session', () => {
    const opened = reduceLegendSession(CLOSED_LEGEND_SESSION, {
      type: 'open',
      defaultPosition: 'right',
    });
    const afterSettingChange = reduceLegendSession(opened, {
      type: 'open',
      defaultPosition: 'bottom',
    });
    const closed = reduceLegendSession(afterSettingChange, { type: 'close' });
    const reopened = reduceLegendSession(closed, { type: 'open', defaultPosition: 'bottom' });

    expect(afterSettingChange).toEqual({ open: true, position: 'right' });
    expect(reopened).toEqual({ open: true, position: 'bottom' });
  });

  it('ignores a position choice while closed', () => {
    expect(
      reduceLegendSession(CLOSED_LEGEND_SESSION, { type: 'move', position: 'bottom' }),
    ).toBe(CLOSED_LEGEND_SESSION);
  });
});

describe('resolveLegendLayout', () => {
  it('uses the current-session position when its overlay dimensions are usable', () => {
    expect(
      resolveLegendLayout({
        position: 'right',
        width: MIN_RIGHT_OVERLAY_HOST_WIDTH,
        height: MIN_RIGHT_OVERLAY_HOST_HEIGHT,
      }),
    ).toBe('right');
    expect(
      resolveLegendLayout({
        position: 'bottom',
        width: MIN_BOTTOM_OVERLAY_HOST_WIDTH,
        height: MIN_BOTTOM_OVERLAY_HOST_HEIGHT,
      }),
    ).toBe('bottom');
  });

  it('uses full when either required host dimension is constrained', () => {
    expect(
      resolveLegendLayout({
        position: 'right',
        width: MIN_RIGHT_OVERLAY_HOST_WIDTH - 1,
        height: MIN_RIGHT_OVERLAY_HOST_HEIGHT,
      }),
    ).toBe('full');
    expect(
      resolveLegendLayout({
        position: 'bottom',
        width: MIN_BOTTOM_OVERLAY_HOST_WIDTH,
        height: MIN_BOTTOM_OVERLAY_HOST_HEIGHT - 1,
      }),
    ).toBe('full');
  });

  it('restores the same session position when a full layout becomes usable', () => {
    const session = reduceLegendSession(CLOSED_LEGEND_SESSION, {
      type: 'open',
      defaultPosition: 'bottom',
    });
    if (!session.open) throw new Error('expected an open legend session');

    const constrained = resolveLegendLayout({ position: session.position, width: 200, height: 200 });
    const restored = resolveLegendLayout({
      position: session.position,
      width: MIN_BOTTOM_OVERLAY_HOST_WIDTH,
      height: MIN_BOTTOM_OVERLAY_HOST_HEIGHT,
    });

    expect(constrained).toBe('full');
    expect(session.position).toBe('bottom');
    expect(restored).toBe('bottom');
  });

  it('treats invalid host dimensions as constrained', () => {
    expect(resolveLegendLayout({ position: 'right', width: Number.NaN, height: 400 })).toBe('full');
    expect(resolveLegendLayout({ position: 'bottom', width: 800, height: Number.POSITIVE_INFINITY })).toBe(
      'full',
    );
  });
});
