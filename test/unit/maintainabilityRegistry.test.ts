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
    // The name must appear inside an actual import-from-debug-log statement -
    // a mention in a comment or a local declaration is not a live use.
    for (const allowance of registry.boundary.allowances) {
      const source = readFileSync(fromRoot(allowance.file), 'utf8');
      const liveImport = new RegExp(
        String.raw`import\s+(?:type\s+)?\{[^}]*\b` +
          allowance.importName +
          String.raw`\b[^}]*\}\s*from\s*['"][^'"]*debugLog(?:\.\w+)?['"]`,
      );
      expect(source).toMatch(liveImport);
    }
  });

  it('holds the allowance/seam handshake against the state on disk', () => {
    const seamExists = existsSync(fromRoot(registry.boundary.seamModule));
    expect(allowanceStateViolations(registry, seamExists)).toEqual([]);
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
    delete (registry.boundary.allowances[0].record as { approval?: string }).approval;
    expect(() => validateRegistry(registry)).toThrow(/approval/);
    expect(() => validateRegistry(registry)).toThrow(/captureGanttLifecycle/);
  });

  it('rejects an allowance missing its remover', () => {
    const registry = base();
    delete (registry.boundary.allowances[0] as { removedBy?: string }).removedBy;
    expect(() => validateRegistry(registry)).toThrow(/removedBy/);
  });

  it('rejects an allowance missing its date', () => {
    const registry = base();
    delete (registry.boundary.allowances[0] as { dated?: string }).dated;
    expect(() => validateRegistry(registry)).toThrow(/dated/);
  });

  it('rejects an allowance naming a file outside the boundary set', () => {
    const registry = base();
    registry.boundary.allowances[0].file = 'src/bases/entrySignature.ts';
    expect(() => validateRegistry(registry)).toThrow(/boundary/);
    expect(() => validateRegistry(registry)).toThrow(/entrySignature\.ts/);
  });

  it('rejects an allowance duplicating the base allowlist', () => {
    const registry = base();
    registry.boundary.allowances[0].importName = 'dlog';
    expect(() => validateRegistry(registry)).toThrow(/allowlist/);
    expect(() => validateRegistry(registry)).toThrow(/dlog/);
  });

  it('rejects a duplicate allowance for the same file and name', () => {
    const registry = base();
    registry.boundary.allowances.push(
      cloneRegistry(registry).boundary.allowances[0],
    );
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
  const someAllowance = (): Registry['boundary']['allowances'] =>
    [cloneRegistry(committedRegistry).boundary.allowances[0]];

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
