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

describe('maintainability registry — committed data', () => {
  const registry = readRegistry();

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

  it('names the lifecycle global the debug-log module actually writes', () => {
    const source = readFileSync(fromRoot(registry.boundary.module), 'utf8');
    expect(source).toContain(registry.boundary.lifecycleGlobal);
  });

  it('carries no stale allowance: each allowed name is referenced by its file today', () => {
    for (const allowance of registry.boundary.allowances) {
      const source = readFileSync(fromRoot(allowance.file), 'utf8');
      expect(source).toContain(allowance.importName);
    }
  });

  it('holds the allowance/seam handshake against the state on disk', () => {
    const seamExists = existsSync(fromRoot(registry.boundary.seamModule));
    expect(allowanceStateViolations(registry, seamExists)).toEqual([]);
  });
});

describe('validateRegistry — schema guards name the offending entry', () => {
  const base = (): Registry => cloneRegistry(readRegistry());

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

  it('rejects a baseline without a full-length sha', () => {
    const registry = base();
    registry.baseline.sha = 'abc123';
    expect(() => validateRegistry(registry)).toThrow(/sha/);
  });
});

describe('allowanceStateViolations — the allowance/seam handshake', () => {
  const registryWith = (allowances: Registry['boundary']['allowances']): Registry => {
    const registry = cloneRegistry(readRegistry());
    registry.boundary.allowances = allowances;
    return registry;
  };
  const someAllowance = (): Registry['boundary']['allowances'] =>
    [cloneRegistry(readRegistry()).boundary.allowances[0]];

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
