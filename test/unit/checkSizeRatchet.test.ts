/**
 * The size ratchet's decision logic: a count above baseline fails, equal
 * passes, lower passes and reports the new baseline; the eslint complexity
 * ceilings are downward-only (a raised value or a new entry fails). The real
 * eslint config is checked against the real ceiling baselines here too, so a
 * ceiling edit fails the fast jest lane before CI's script step.
 */
import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  CEILING_BASELINES,
  LINE_BASELINES,
  checkCeilingBaselines,
  checkLineBaselines,
  countLines,
  extractComplexityCeilings,
} from '../../scripts/check-size-ratchet.mjs';

const fileOf = (lines: number): string => 'x\n'.repeat(lines);

describe('checkLineBaselines', () => {
  it('fails a file above its baseline', () => {
    const { violations } = checkLineBaselines({ 'a.ts': 10 }, () => fileOf(11));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('11 lines exceeds the ratchet baseline of 10');
  });

  it('passes a file exactly at its baseline, with nothing to report', () => {
    const { violations, improvements } = checkLineBaselines({ 'a.ts': 10 }, () => fileOf(10));
    expect(violations).toEqual([]);
    expect(improvements).toEqual([]);
  });

  it('passes a file below its baseline and reports the new baseline to lock in', () => {
    const { violations, improvements } = checkLineBaselines({ 'a.ts': 10 }, () => fileOf(7));
    expect(violations).toEqual([]);
    expect(improvements).toHaveLength(1);
    expect(improvements[0]).toContain('lowering the baseline to 7');
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

  it('passes unchanged and lowered ceilings, and a removed entry', () => {
    expect(checkCeilingBaselines({ 'a.ts': 20 }, { 'a.ts': 20, 'gone.ts': 30 })).toEqual([]);
    expect(checkCeilingBaselines({ 'a.ts': 18 }, { 'a.ts': 20 })).toEqual([]);
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
    expect(checkCeilingBaselines(raised, CEILING_BASELINES)).toHaveLength(1);
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
