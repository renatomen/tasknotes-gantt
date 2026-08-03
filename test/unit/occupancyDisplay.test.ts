/**
 * Occupancy-display pure-module tests: piece-level click routing for the
 * occupancy runs the `BarContent` occupancy branch renders. The envelope and
 * run shaping are pinned at the ganttSync seam (ganttSyncOccupancy.test.ts),
 * where they compose with the SVAR task build.
 */

import { describe, it, expect } from '@jest/globals';
import { resolveOccupancyActivationPath } from '../../src/bases/occupancyDisplay';

const STANDUP_PATH = 'routines/standup.md';

describe('resolveOccupancyActivationPath — piece click routing', () => {
  it('routes a materialized piece to its backing note', () => {
    expect(
      resolveOccupancyActivationPath(
        { stateClass: 'materialized', notePath: 'routines/standup 2026-01-13.md' },
        STANDUP_PATH,
      ),
    ).toBe('routines/standup 2026-01-13.md');
  });

  it('routes every other piece to the parent recurring task', () => {
    expect(resolveOccupancyActivationPath({ stateClass: 'projected' }, STANDUP_PATH)).toBe(
      STANDUP_PATH,
    );
    expect(resolveOccupancyActivationPath({ stateClass: 'completed' }, STANDUP_PATH)).toBe(
      STANDUP_PATH,
    );
  });

  it('falls back to the parent when a materialized piece lost its note path', () => {
    expect(resolveOccupancyActivationPath({ stateClass: 'materialized' }, STANDUP_PATH)).toBe(
      STANDUP_PATH,
    );
  });
});
