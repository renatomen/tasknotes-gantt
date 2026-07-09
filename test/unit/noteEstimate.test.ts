/**
 * Unit tests for the Time Estimate read helpers (U4).
 *
 * `coerceEstimateMinutes` enforces R4 (positive integer minutes; anything else is
 * "no estimate"). `resolveNoteEstimate` reads the value cache-safely by path for
 * companion-expanded tasks that have no Bases entry.
 */
import { TFile } from 'obsidian';
import { coerceEstimateMinutes, resolveNoteEstimate } from '../../src/datasource/noteEstimate';

describe('coerceEstimateMinutes (R4)', () => {
  it('accepts a positive integer number of minutes', () => {
    expect(coerceEstimateMinutes(120)).toBe(120);
    expect(coerceEstimateMinutes(1)).toBe(1);
  });

  it('accepts a numeric string', () => {
    expect(coerceEstimateMinutes('120')).toBe(120);
  });

  it('treats zero, negative, non-integer, and non-numeric values as no estimate', () => {
    expect(coerceEstimateMinutes(0)).toBeNull();
    expect(coerceEstimateMinutes(-5)).toBeNull();
    expect(coerceEstimateMinutes(12.5)).toBeNull();
    expect(coerceEstimateMinutes('abc')).toBeNull();
    expect(coerceEstimateMinutes('')).toBeNull();
    expect(coerceEstimateMinutes(null)).toBeNull();
    expect(coerceEstimateMinutes(undefined)).toBeNull();
  });
});

describe('resolveNoteEstimate (R6)', () => {
  const makeApp = (frontmatter: Record<string, unknown> | undefined, isFile = true) => {
    const file = isFile ? Object.assign(new TFile(), { path: 'Task.md' }) : {};
    return {
      vault: { getAbstractFileByPath: () => file },
      metadataCache: { getFileCache: () => (frontmatter ? { frontmatter } : {}) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  };

  it('reads the frontmatter estimate by bare key', () => {
    expect(resolveNoteEstimate(makeApp({ estimate: 240 }), 'Task.md', 'estimate')).toBe(240);
  });

  it('returns null when the key is unset or the value is invalid', () => {
    expect(resolveNoteEstimate(makeApp({ estimate: 0 }), 'Task.md', 'estimate')).toBeNull();
    expect(resolveNoteEstimate(makeApp({}), 'Task.md', 'estimate')).toBeNull();
    expect(resolveNoteEstimate(makeApp(undefined), 'Task.md', 'estimate')).toBeNull();
  });

  it('returns null when no estimate key is resolvable', () => {
    expect(resolveNoteEstimate(makeApp({ estimate: 240 }), 'Task.md', null)).toBeNull();
  });

  it('returns null when the path is not a file', () => {
    expect(resolveNoteEstimate(makeApp({ estimate: 240 }, false), 'Missing.md', 'estimate')).toBeNull();
  });
});
