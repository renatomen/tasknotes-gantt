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
  it('is exactly the receipts gate then the trend print — no other executable line', () => {
    // The whole array, not per-line substrings: an inserted `exit 0`, a
    // `true ||` prefix, or a reordering all leave weaker assertions green
    // while the gate never runs. Any change to what executes must fail here.
    expect(hookLines).toEqual([
      'node scripts/check-review-receipts.mjs check',
      'node scripts/maintainability-trend.mjs < /dev/null || true',
    ]);
  });

  it('keeps the receipts gate before the trend print, which must read git’s stdin first', () => {
    expect(receiptsIndex).toBe(0);
    expect(trendIndex).toBe(1);
  });
});
