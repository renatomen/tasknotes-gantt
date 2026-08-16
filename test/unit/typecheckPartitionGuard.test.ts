import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
      .filter((path) => /(^|\/)_local-/i.test(path));
    expect(tracked).toEqual([]);
  });

  /**
   * The jest program sets `allowJs: true` (checkJs off) solely so tests can
   * import `scripts/*.mjs` with real inferred types. That same flag would let
   * an in-tree .js/.cjs/.mjs file join the program with zero diagnostics —
   * running under jest while silently escaping typecheck. This guard bans
   * tracked JS from the jest tree entirely (the excluded e2e/vitest trees have
   * their own programs and are out of scope here).
   */
  it('no tracked JS under the jest tree escapes typecheck', () => {
    const excludedTrees = /^test\/(specs|wdio|perf\/isolated|probe)\//i;
    const tracked = execFileSync('git', ['ls-files', 'test'], { encoding: 'utf8' })
      .split('\n')
      .filter((path) => /\.(js|cjs|mjs)$/i.test(path))
      .filter((path) => !excludedTrees.test(path))
      // A tracked file deleted from the worktree cannot run under jest, so it
      // is not an escape; in CI the worktree always matches the index.
      .filter((path) => existsSync(path));
    expect(tracked).toEqual([]);
  });
});
