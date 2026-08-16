import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * NUL-delimited on purpose: newline-delimited `git ls-files` C-quotes paths
 * with non-ASCII characters, and the trailing quote defeats `$`-anchored
 * extension matching — a `test/unit/mañana.js` would slip past the JS ban.
 */
function trackedTestPaths(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', 'test'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0);
}

/**
 * The typecheck partition (tsconfig.test-unit / test-e2e / test-vitest) may
 * exclude `test/specs/_local-*` because that pattern is the sanctioned home of
 * GITIGNORED personal probes. A tracked file matching it — renamed into the
 * pattern, or force-added — would run nowhere and typecheck nowhere, silently
 * escaping the gate. This guard makes that state fail the suite instead.
 */
describe('typecheck partition guard', () => {
  it('no committed test file hides under the _local-* personal-probe convention', () => {
    const tracked = trackedTestPaths().filter((path) => /(^|\/)_local-/i.test(path));
    expect(tracked).toEqual([]);
  });

  /**
   * The jest program sets `allowJs: true` (checkJs off) solely so tests can
   * import `scripts/*.mjs` with real inferred types. That same flag would let
   * an in-tree JS file join the program with zero diagnostics — running under
   * jest while silently escaping typecheck. No exemption for the e2e/vitest
   * trees: their programs never admit JS at all, and TypeScript follows
   * imports across `exclude`, so a unit test importing `test/specs/foo.js`
   * would execute unchecked JS no program owns. Tracked JS is banned across
   * all of `test/`.
   */
  it('no tracked JS anywhere under test/ escapes typecheck', () => {
    const tracked = trackedTestPaths()
      .filter((path) => /\.(js|cjs|mjs|jsx)$/i.test(path))
      // A tracked file deleted from the worktree cannot run under jest, so it
      // is not an escape; in CI the worktree always matches the index.
      .filter((path) => existsSync(path));
    expect(tracked).toEqual([]);
  });
});
