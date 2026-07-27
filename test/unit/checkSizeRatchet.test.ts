/**
 * The size ratchet's decision logic: a count above baseline fails, equal
 * passes, and lower FAILS TOO until the baseline is lowered to the new count —
 * the one-way lock that stops a stale baseline from letting a later change
 * regrow the file. The eslint complexity ceilings ratchet the same way (a
 * raised value, a new entry, an unlocked lower value, or a stale baseline for
 * a removed exemption all fail). The real eslint config is checked against the
 * real ceiling baselines here too, so a ceiling edit fails the fast jest lane
 * before CI's script step.
 */
import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  CEILING_BASELINES,
  LINE_BASELINES,
  checkCeilingBaselines,
  checkLineBaselines,
  compareAgainstBase,
  countLines,
  extractBaselineTable,
  extractComplexityCeilings,
} from '../../scripts/check-size-ratchet.mjs';

const fileOf = (lines: number): string => 'x\n'.repeat(lines);

describe('checkLineBaselines', () => {
  it('fails a file above its baseline', () => {
    const violations = checkLineBaselines({ 'a.ts': 10 }, () => fileOf(11));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('11 lines exceeds the ratchet baseline of 10');
  });

  it('passes a file exactly at its baseline', () => {
    expect(checkLineBaselines({ 'a.ts': 10 }, () => fileOf(10))).toEqual([]);
  });

  it('FAILS a file below its baseline, demanding the new lower count be locked in', () => {
    const violations = checkLineBaselines({ 'a.ts': 10 }, () => fileOf(7));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('below the baseline of 10');
    expect(violations[0]).toContain('lowering LINE_BASELINES in scripts/check-size-ratchet.mjs to 7');
  });

  it('passes again once the baseline is lowered to the new count', () => {
    expect(checkLineBaselines({ 'a.ts': 7 }, () => fileOf(7))).toEqual([]);
  });

  it('counts wc -l style: a trailing newline starts no new line', () => {
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
  });
});

describe('checkCeilingBaselines', () => {
  it('fails when a recorded ceiling increases', () => {
    const violations = checkCeilingBaselines({ 'a.ts': 21 }, { 'a.ts': 20 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('rose to 21 (baseline 20)');
  });

  it('passes a ceiling exactly at its baseline', () => {
    expect(checkCeilingBaselines({ 'a.ts': 20 }, { 'a.ts': 20 })).toEqual([]);
  });

  it('FAILS a ceiling below its baseline, demanding the new lower value be locked in', () => {
    const violations = checkCeilingBaselines({ 'a.ts': 18 }, { 'a.ts': 20 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('below the baseline of 20');
    expect(violations[0]).toContain('lowering CEILING_BASELINES in scripts/check-size-ratchet.mjs to 18');
  });

  it('passes again once the lowered ceiling\'s baseline is locked to the new value', () => {
    expect(checkCeilingBaselines({ 'a.ts': 18 }, { 'a.ts': 18 })).toEqual([]);
  });

  it('FAILS a removed exemption whose stale baseline lingers, demanding the entry\'s removal', () => {
    const violations = checkCeilingBaselines({ 'a.ts': 20 }, { 'a.ts': 20, 'gone.ts': 30 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('[gone.ts]');
    expect(violations[0]).toContain('deleting its CEILING_BASELINES entry');
  });

  it('passes again once the removed exemption\'s baseline entry is deleted', () => {
    expect(checkCeilingBaselines({ 'a.ts': 20 }, { 'a.ts': 20 })).toEqual([]);
  });

  it('fails a NEW per-file ceiling entry — the exemption list may only shrink', () => {
    const violations = checkCeilingBaselines({ 'new.ts': 17 }, {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('new cognitive-complexity ceiling');
  });
});

describe('extractComplexityCeilings', () => {
  it('keys each ceiling by the sorted files list and keeps the highest per key', () => {
    const ceilings = extractComplexityCeilings([
      { files: ['b.ts', 'a.ts'], rules: { 'sonarjs/cognitive-complexity': ['error', 16] } },
      { rules: { 'sonarjs/cognitive-complexity': ['error', 15] } },
      { files: ['c.ts'], rules: { 'max-lines': 'off' } },
    ]);
    expect(ceilings).toEqual({ 'a.ts|b.ts': 16, '<global>': 15 });
  });

  it('a raised ceiling in a config shaped like ours is caught end to end', () => {
    const raised = extractComplexityCeilings([
      { files: ['test/__mocks__/obsidian.ts'], rules: { 'sonarjs/cognitive-complexity': ['error', 24] } },
    ]);
    const violations = checkCeilingBaselines(raised, CEILING_BASELINES);
    expect(violations.filter((v) => v.includes('rose to 24 (baseline 23)'))).toHaveLength(1);
  });
});

/** A base-ref script in the real file's shape, carrying the given tables. */
function baseSourceOf(
  lines: Record<string, number>,
  ceilings: Record<string, number> = {},
): string {
  const table = (entries: Record<string, number>): string =>
    Object.entries(entries)
      .map(([key, value]) => `  "${key}": ${value},`)
      .join('\n');
  return [
    'export const LINE_BASELINES = {',
    table(lines),
    '};',
    'export const CEILING_BASELINES = {',
    table(ceilings),
    '};',
  ].join('\n');
}

describe('compareAgainstBase (CI: baselines vs the TARGET branch)', () => {
  const current = { lines: { 'a.ts': 100 }, ceilings: { '**/*.ts': 15 } };

  it('fails a RAISED baseline against the base ref', () => {
    const violations = compareAgainstBase(baseSourceOf({ 'a.ts': 90 }, { '**/*.ts': 15 }), current);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('[a.ts] rose from 90 to 100');
  });

  it('passes a lowered baseline', () => {
    expect(
      compareAgainstBase(baseSourceOf({ 'a.ts': 110 }, { '**/*.ts': 15 }), current),
    ).toEqual([]);
  });

  it('fails a REMOVED line entry — a ratcheted file may not leave the table', () => {
    const violations = compareAgainstBase(
      baseSourceOf({ 'a.ts': 100, 'gone.ts': 40 }, { '**/*.ts': 15 }),
      current,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('[gone.ts] was removed');
  });

  it('passes a REMOVED ceiling entry — deleting a retired exemption\'s baseline is the locked-in path', () => {
    expect(
      compareAgainstBase(
        baseSourceOf({ 'a.ts': 100 }, { '**/*.ts': 15, 'retired.ts': 22 }),
        current,
      ),
    ).toEqual([]);
  });

  it('passes an ADDED entry — newly ratcheted files are welcome', () => {
    expect(
      compareAgainstBase(baseSourceOf({ 'a.ts': 100 }, { '**/*.ts': 15 }), {
        lines: { 'a.ts': 100, 'new.ts': 50 },
        ceilings: { '**/*.ts': 15 },
      }),
    ).toEqual([]);
  });

  it('guards ceilings the same way: a raised ceiling fails', () => {
    const violations = compareAgainstBase(
      baseSourceOf({ 'a.ts': 100 }, { '**/*.ts': 14 }),
      current,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('[**/*.ts] rose from 14 to 15');
  });

  it('refuses to compare when a table is missing from the base source', () => {
    const violations = compareAgainstBase('// not the script', current);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('not found');
  });

  it('extracts the REAL script\'s own tables verbatim (the format the regex must keep matching)', () => {
    const source = readFileSync('scripts/check-size-ratchet.mjs', 'utf8');
    expect(extractBaselineTable(source, 'LINE_BASELINES')).toEqual(LINE_BASELINES);
    expect(extractBaselineTable(source, 'CEILING_BASELINES')).toEqual(CEILING_BASELINES);
    // And a self-comparison is clean by definition.
    expect(compareAgainstBase(source)).toEqual([]);
  });
});

describe('the real working tree against the recorded baselines', () => {
  it('the ratchet script itself passes (line counts AND eslint ceilings)', () => {
    // Real integration: the same invocation CI runs, so a grown file or a
    // raised ceiling fails the fast jest lane before the CI step.
    // Jest's cwd is the repo root, where the script's relative paths resolve.
    const out = execFileSync(process.execPath, ['scripts/check-size-ratchet.mjs'], {
      encoding: 'utf8',
    });
    expect(out).toContain('size ratchet OK');
  });

  it('pins the ratcheted files themselves', () => {
    expect(Object.keys(LINE_BASELINES).sort((a, b) => a.localeCompare(b))).toEqual([
      'src/bases/GanttContainer.svelte',
      'src/bases/register.ts',
    ]);
  });
});
