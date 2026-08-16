import { execFileSync } from 'node:child_process';

/**
 * The typecheck partition (tsconfig.test-unit / test-e2e / test-vitest) may
 * exclude `test/specs/_local-*` because that pattern is the sanctioned home of
 * GITIGNORED personal probes. A tracked file matching it — renamed into the
 * pattern, or force-added — would run nowhere and typecheck nowhere, silently
 * escaping the gate. This guard makes that state fail the suite instead.
 */
describe('typecheck partition guard', () => {
  it('no committed test file hides under the _local-* personal-probe convention', () => {
    const tracked = execFileSync('git', ['ls-files', 'test'], { encoding: 'utf8' })
      .split('\n')
      .filter((path) => /(^|\/)_local-/.test(path));
    expect(tracked).toEqual([]);
  });
});
