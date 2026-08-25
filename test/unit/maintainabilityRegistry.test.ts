/**
 * Guards for `maintainability-registry.json` — the single committed source for
 * the ranked-file list, the placement-boundary configuration, and the interim
 * allowances that bridge the boundary gate to the extraction that removes them.
 *
 * The registry drives real enforcement (the ESLint overrides are derived from
 * it), so a malformed or stale entry must fail loudly here rather than let a
 * lint glob silently match nothing after a rename.
 */
import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  allowanceStateViolations,
  readRegistry,
  validateRegistry,
} from '../../scripts/maintainability-registry.mjs';

type Registry = ReturnType<typeof readRegistry>;

const cloneRegistry = (registry: Registry): Registry =>
  JSON.parse(JSON.stringify(registry)) as Registry;

const fromRoot = (relativePath: string): string => resolve(process.cwd(), relativePath);

const committedRegistry = readRegistry();

/**
 * The committed registry carries no allowances once the seam exists, so the
 * schema and handshake guards plant this fully-formed synthetic entry to
 * exercise the allowance rules.
 */
const syntheticAllowance = (): Registry['boundary']['allowances'][number] => ({
  file: 'src/bases/register.ts',
  importName: 'captureGanttLifecycle',
  dated: '2026-08-25',
  removedBy: 'synthetic-test-fixture',
  record: {
    delta: 'synthetic test fixture',
    whyNotSeam: 'exercises the allowance schema guards',
    alternatives: 'none: committed allowances retired with the seam',
    approval: 'not applicable: in-memory fixture',
  },
});

describe('maintainability registry — committed data', () => {
  const registry = committedRegistry;

  it('validates against the schema', () => {
    expect(() => validateRegistry(registry)).not.toThrow();
  });

  it('lists every ranked path at a location that exists on disk', () => {
    const missing = registry.rankedFiles
      .map((entry) => entry.path)
      .filter((path) => !existsSync(fromRoot(path)));
    expect(missing).toEqual([]);
  });

  it('lists boundary module and junction files at locations that exist on disk', () => {
    const paths = [registry.boundary.module, ...registry.boundary.files.map((f) => f.path)];
    const missing = paths.filter((path) => !existsSync(fromRoot(path)));
    expect(missing).toEqual([]);
  });

  it('names the lifecycle global the debug-log module actually assigns on globalThis', () => {
    const source = readFileSync(fromRoot(registry.boundary.module), 'utf8');
    // Assignment only, bound to the globalThis receiver: no dot may intervene
    // (so another object's member cannot satisfy it) and `=(?!=)` excludes
    // comparison reads like `=== undefined`.
    const sinkAssignment = (globalName: string): RegExp =>
      new RegExp(
        String.raw`globalThis[^.;]{0,200}\.` +
          globalName.replace(/\$/g, String.raw`\$`) +
          String.raw`\s*=(?!=)`,
      );
    expect(source).toMatch(sinkAssignment(registry.boundary.lifecycleGlobal));
    // Wrong-but-present control: an exported name that occurs in the module
    // but is never assigned on globalThis must not satisfy the matcher.
    expect(source).toContain('ganttLifecycleControl');
    expect(source).not.toMatch(sinkAssignment('ganttLifecycleControl'));
  });

  it('carries no stale allowance: each allowed name is imported from the debug-log module today', () => {
    // The name must appear inside an actual import-from-debug-log statement.
    // Comments are stripped first and the statement must start a line, so a
    // commented-out import or a mention in prose is not a live use.
    const hasLiveDebugLogImport = (rawSource: string, importName: string): boolean => {
      const source = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
      const liveImport = new RegExp(
        String.raw`(?:^|\n)[ \t]*import\s+(?:type\s+)?\{[^}]*\b` +
          importName +
          String.raw`\b[^}]*\}\s*from\s*['"][^'"]*debugLog(?:\.\w+)?['"]`,
      );
      return liveImport.test(source);
    };

    expect(
      hasLiveDebugLogImport(
        "import { captureGanttLifecycle } from '../debugLog';",
        'captureGanttLifecycle',
      ),
    ).toBe(true);
    expect(
      hasLiveDebugLogImport(
        "// import { captureGanttLifecycle } from '../debugLog';",
        'captureGanttLifecycle',
      ),
    ).toBe(false);
    expect(
      hasLiveDebugLogImport(
        "/* import { captureGanttLifecycle } from '../debugLog'; */",
        'captureGanttLifecycle',
      ),
    ).toBe(false);

    for (const allowance of registry.boundary.allowances) {
      const source = readFileSync(fromRoot(allowance.file), 'utf8');
      expect(hasLiveDebugLogImport(source, allowance.importName)).toBe(true);
    }
  });

  it('holds the allowance/seam handshake against the state on disk', () => {
    const seamExists = existsSync(fromRoot(registry.boundary.seamModule));
    expect(allowanceStateViolations(registry, seamExists)).toEqual([]);
  });

  it('lists every dated report at a location that exists on disk', () => {
    expect(registry.reports.length).toBeGreaterThan(0);
    const missing = registry.reports
      .map((entry) => entry.report)
      .filter((path) => !existsSync(fromRoot(path)));
    expect(missing).toEqual([]);
  });
});

describe('validateRegistry — schema guards name the offending entry', () => {
  const base = (): Registry => cloneRegistry(committedRegistry);

  it('rejects a ranked file without a rank', () => {
    const registry = base();
    delete (registry.rankedFiles[0] as { rank?: number }).rank;
    expect(() => validateRegistry(registry)).toThrow(/rank/);
    expect(() => validateRegistry(registry)).toThrow(/GanttContainer\.svelte/);
  });

  it('rejects a duplicate ranked path', () => {
    const registry = base();
    registry.rankedFiles.push({ ...registry.rankedFiles[0] });
    expect(() => validateRegistry(registry)).toThrow(/duplicate/i);
  });

  it('rejects a boundary file that is not a ranked entry', () => {
    const registry = base();
    registry.boundary.files[0].path = 'src/main.ts';
    expect(() => validateRegistry(registry)).toThrow(/ranked/);
    expect(() => validateRegistry(registry)).toThrow(/src\/main\.ts/);
  });

  it('rejects an allowance missing a record field', () => {
    const registry = base();
    registry.boundary.allowances = [syntheticAllowance()];
    delete (registry.boundary.allowances[0].record as { approval?: string }).approval;
    expect(() => validateRegistry(registry)).toThrow(/approval/);
    expect(() => validateRegistry(registry)).toThrow(/captureGanttLifecycle/);
  });

  it('rejects an allowance missing its remover', () => {
    const registry = base();
    registry.boundary.allowances = [syntheticAllowance()];
    delete (registry.boundary.allowances[0] as { removedBy?: string }).removedBy;
    expect(() => validateRegistry(registry)).toThrow(/removedBy/);
  });

  it('rejects an allowance missing its date', () => {
    const registry = base();
    registry.boundary.allowances = [syntheticAllowance()];
    delete (registry.boundary.allowances[0] as { dated?: string }).dated;
    expect(() => validateRegistry(registry)).toThrow(/dated/);
  });

  it('rejects an allowance naming a file outside the boundary set', () => {
    const registry = base();
    registry.boundary.allowances = [syntheticAllowance()];
    registry.boundary.allowances[0].file = 'src/bases/entrySignature.ts';
    expect(() => validateRegistry(registry)).toThrow(/boundary/);
    expect(() => validateRegistry(registry)).toThrow(/entrySignature\.ts/);
  });

  it('rejects an allowance duplicating the base allowlist', () => {
    const registry = base();
    registry.boundary.allowances = [syntheticAllowance()];
    registry.boundary.allowances[0].importName = 'dlog';
    expect(() => validateRegistry(registry)).toThrow(/allowlist/);
    expect(() => validateRegistry(registry)).toThrow(/dlog/);
  });

  it('rejects a duplicate allowance for the same file and name', () => {
    const registry = base();
    registry.boundary.allowances = [syntheticAllowance(), syntheticAllowance()];
    expect(() => validateRegistry(registry)).toThrow(/duplicate/i);
  });

  it('rejects an empty base allowlist', () => {
    const registry = base();
    registry.boundary.allowedImportNames = [];
    expect(() => validateRegistry(registry)).toThrow(/allowedImportNames/);
  });

  it('rejects a widened base allowlist: lifecycle names need per-file allowances', () => {
    const registry = base();
    registry.boundary.allowedImportNames.push('captureGanttLifecycle');
    expect(() => validateRegistry(registry)).toThrow(/exactly the base logging allowlist/);
  });

  it('rejects a lifecycle global that is not a plain identifier', () => {
    const registry = base();
    registry.boundary.lifecycleGlobal = '__tn[Gantt]Lifecycle';
    expect(() => validateRegistry(registry)).toThrow(/identifier/);
  });

  it('rejects a boundary module path carrying regex metacharacters', () => {
    const registry = base();
    registry.boundary.module = 'src/debug(Log).ts';
    expect(() => validateRegistry(registry)).toThrow(/plain path/);
  });

  it('rejects a reports entry whose date is not zero-padded YYYY-MM-DD', () => {
    const registry = base();
    (registry.reports[0] as { date: string }).date = '2026-8-16';
    expect(() => validateRegistry(registry)).toThrow(/YYYY-MM-DD/);
  });

  it('rejects a reports entry whose date is not a real calendar date', () => {
    const registry = base();
    (registry.reports[0] as { date: string }).date = '2026-99-99';
    expect(() => validateRegistry(registry)).toThrow(/real, zero-padded/);
    // Digit-shaped but rolled over: only a calendar round-trip catches it.
    (registry.reports[0] as { date: string }).date = '2026-02-31';
    expect(() => validateRegistry(registry)).toThrow(/real, zero-padded/);
  });

  it('rejects a concernCounts that is not an object of path -> count', () => {
    const registry = base();
    (registry.reports[5] as { concernCounts: unknown }).concernCounts = 7;
    expect(() => validateRegistry(registry)).toThrow(/must be an object of path -> count/);
    // An explicit null is malformed data, not an omitted field.
    (registry.reports[5] as { concernCounts: unknown }).concernCounts = null;
    expect(() => validateRegistry(registry)).toThrow(/must be an object of path -> count/);
  });

  it('rejects a reports entry whose measurement values are not non-negative integers', () => {
    const withBadAtCeiling = base();
    (withBadAtCeiling.reports[5] as { atCeiling: unknown }).atCeiling = 'sixteen';
    expect(() => validateRegistry(withBadAtCeiling)).toThrow(/atCeiling must be a non-negative integer/);

    const withBadCount = base();
    (withBadCount.reports[5] as { concernCounts: Record<string, unknown> }).concernCounts[
      'src/bases/register.ts'
    ] = -1;
    expect(() => validateRegistry(withBadCount)).toThrow(/non-negative integer/);
  });

  it('rejects a reports entry without a full-length anchor sha', () => {
    const registry = base();
    (registry.reports[0] as { anchorSha: string }).anchorSha = 'abc123';
    expect(() => validateRegistry(registry)).toThrow(/anchorSha/);
  });

  it('rejects a reports entry that does not name its dated report file', () => {
    const registry = base();
    delete (registry.reports[0] as { report?: string }).report;
    expect(() => validateRegistry(registry)).toThrow(/dated report file/);
  });

  it('rejects a baseline without a full-length sha', () => {
    const registry = base();
    registry.baseline.sha = 'abc123';
    expect(() => validateRegistry(registry)).toThrow(/sha/);
  });
});

describe('allowanceStateViolations — the allowance/seam handshake', () => {
  const registryWith = (allowances: Registry['boundary']['allowances']): Registry => {
    const registry = cloneRegistry(committedRegistry);
    registry.boundary.allowances = allowances;
    return registry;
  };
  const someAllowance = (): Registry['boundary']['allowances'] => [syntheticAllowance()];

  it('permits interim allowances while the seam module does not exist', () => {
    expect(allowanceStateViolations(registryWith(someAllowance()), false)).toEqual([]);
  });

  it('refuses any allowance once the seam module exists', () => {
    const violations = allowanceStateViolations(registryWith(someAllowance()), true);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join('\n')).toContain('captureGanttLifecycle');
  });

  it('refuses an empty allowance list while the seam module does not exist', () => {
    const violations = allowanceStateViolations(registryWith([]), false);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join('\n')).toMatch(/seam/i);
  });

  it('accepts an empty allowance list once the seam module exists', () => {
    expect(allowanceStateViolations(registryWith([]), true)).toEqual([]);
  });
});
