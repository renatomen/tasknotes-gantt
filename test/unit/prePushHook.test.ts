/**
 * Source-reading guard for `.husky/pre-push`.
 *
 * The hook runs under `sh -e` and the receipts check READS GIT'S STDIN, so the
 * trend print is safe only in one exact shape: after the receipts line, with
 * stdin redirected away (or it would eat the ref lines the gate needs), and
 * with its exit status ignored (a print must never block a push). This test
 * pins that shape — each assertion names the failure it prevents.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hookLines = readFileSync(resolve('.husky/pre-push'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

const receiptsIndex = hookLines.findIndex((line) =>
  line.includes('check-review-receipts.mjs check'),
);
const trendIndex = hookLines.findIndex((line) => line.includes('maintainability-trend.mjs'));

describe('pre-push hook shape', () => {
  it('runs the receipts gate unconditionally, as exactly its own command', () => {
    // Whole-line equality, not a substring: `true || node …check` contains the
    // command text while disabling the gate, and must fail this claim.
    expect(hookLines[receiptsIndex]).toBe('node scripts/check-review-receipts.mjs check');
  });

  it('prints the trend AFTER the receipts check, which must read git’s stdin first', () => {
    expect(trendIndex).toBeGreaterThan(receiptsIndex);
  });

  it('prints the trend with stdin redirected and its status ignored, as exactly that line', () => {
    // One exact line pins all three properties at once: the print cannot
    // consume the push ref lines, cannot block a push, and cannot grow a
    // prefix that changes what actually runs.
    expect(hookLines[trendIndex]).toBe('node scripts/maintainability-trend.mjs < /dev/null || true');
  });
});
