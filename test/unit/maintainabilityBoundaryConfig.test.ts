/**
 * Guards for the placement-boundary lint gate: the ESLint override objects the
 * registry reader derives, the source-level census that lint rules cannot see
 * (name-collision exports, seam export surface), the no-directive contract on
 * the junction files, and the mutation harness that re-proves every planted
 * violation against the real ESLint config without committing red files.
 */
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  deriveBoundaryOverrides,
  readRegistry,
} from '../../scripts/maintainability-registry.mjs';

type Registry = ReturnType<typeof readRegistry>;

interface RestrictedImportPattern {
  regex: string;
  allowImportNames?: string[];
  message?: string;
}

interface DerivedOverride {
  files: string[];
  ignores?: string[];
  linterOptions?: { noInlineConfig?: boolean };
  languageOptions?: { globals?: Record<string, string> };
  rules: Record<string, unknown>;
}

const registry = readRegistry();
const overrides = deriveBoundaryOverrides() as unknown as DerivedOverride[];
const fromRoot = (relativePath: string): string => resolve(process.cwd(), relativePath);

const importPatterns = (override: DerivedOverride): RestrictedImportPattern[] => {
  const rule = override.rules['no-restricted-imports'] as [
    string,
    { patterns: RestrictedImportPattern[] },
  ];
  return rule[1].patterns;
};

const syntaxSelectors = (override: DerivedOverride): string[] => {
  const rule = override.rules['no-restricted-syntax'] as [string, ...{ selector: string }[]];
  return rule.slice(1).map((entry) => (entry as { selector: string }).selector);
};

describe('deriveBoundaryOverrides — derived override objects', () => {
  it('returns the source-tree closure entry first, then one entry per junction file', () => {
    expect(overrides).toHaveLength(1 + registry.boundary.files.length);
    expect(overrides[0].files).toEqual(['src/**/*.{ts,mts,svelte}']);
    expect(overrides[0].ignores).toEqual([
      registry.boundary.module,
      registry.boundary.seamModule,
    ]);
    registry.boundary.files.forEach((file, index) => {
      expect(overrides[index + 1].files).toEqual([file.path]);
    });
  });

  it('closure entry restricts the whole source tree to the base allowlist', () => {
    const patterns = importPatterns(overrides[0]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].allowImportNames).toEqual(registry.boundary.allowedImportNames);
  });

  it('matches the debug-log module at any relative depth, with and without extension', () => {
    const matcher = new RegExp(importPatterns(overrides[0])[0].regex);
    for (const specifier of [
      '../debugLog',
      '../../debugLog',
      '../debugLog.ts',
      '../../../debugLog.ts',
      'src/debugLog',
    ]) {
      expect(specifier).toMatch(matcher);
    }
    for (const specifier of ['../debugLogUtils', './svarContract', '../render/debugLogger']) {
      expect(specifier).not.toMatch(matcher);
    }
  });

  it("junction entries allow the base allowlist plus exactly that file's dated allowances", () => {
    for (const [index, file] of registry.boundary.files.entries()) {
      const patterns = importPatterns(overrides[index + 1]);
      const expected = [
        ...registry.boundary.allowedImportNames,
        ...registry.boundary.allowances
          .filter((allowance) => allowance.file === file.path)
          .map((allowance) => allowance.importName),
      ];
      expect(patterns[0].allowImportNames).toEqual(expected);
    }
  });

  it('junction entries restrict the seam module to its declared public names', () => {
    for (const [index] of registry.boundary.files.entries()) {
      const patterns = importPatterns(overrides[index + 1]);
      expect(patterns[1].allowImportNames).toEqual(registry.boundary.seamPublicNames);
      const matcher = new RegExp(patterns[1].regex);
      expect('../bases/ganttLifecycleDiagnostics').toMatch(matcher);
      expect('./ganttLifecycleDiagnostics.ts').toMatch(matcher);
      expect('./ganttSyncCoordinator').not.toMatch(matcher);
    }
  });

  it('junction entries disable inline config and carry the declared globals', () => {
    for (const [index, file] of registry.boundary.files.entries()) {
      const override = overrides[index + 1];
      expect(override.linterOptions).toEqual({ noInlineConfig: true });
      expect(override.languageOptions?.globals).toEqual(
        Object.fromEntries(file.globals.map((name) => [name, 'readonly'])),
      );
    }
  });

  it('junction entries forbid dynamic imports, inline import types, and the lifecycle global', () => {
    for (const [index] of registry.boundary.files.entries()) {
      const selectors = syntaxSelectors(overrides[index + 1]);
      expect(selectors.some((s) => s.startsWith('ImportExpression'))).toBe(true);
      expect(selectors.some((s) => s.startsWith('TSImportType'))).toBe(true);
      expect(selectors).toContain(`Identifier[name="${registry.boundary.lifecycleGlobal}"]`);
      expect(selectors.some((s) => s.startsWith('Literal['))).toBe(true);
      expect(selectors.some((s) => s.startsWith('TemplateElement['))).toBe(true);
    }
  });

  it('derives live from the registry: dropping an allowance drops the allowed name', () => {
    const mutated = JSON.parse(JSON.stringify(registry)) as Registry;
    mutated.boundary.allowances = mutated.boundary.allowances.filter(
      (allowance) =>
        !(allowance.file === 'src/bases/register.ts' &&
          allowance.importName === 'captureGanttLifecycle'),
    );
    const derived = deriveBoundaryOverrides(mutated) as unknown as DerivedOverride[];
    const registerIndex =
      1 + registry.boundary.files.findIndex((file) => file.path === 'src/bases/register.ts');
    expect(importPatterns(derived[registerIndex])[0].allowImportNames).not.toContain(
      'captureGanttLifecycle',
    );
    expect(importPatterns(overrides[registerIndex])[0].allowImportNames).toContain(
      'captureGanttLifecycle',
    );
  });
});

/** Exported-name census helpers (shared by the re-export and seam-bound guards). */
const EXPORT_DECLARATION = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/;
const EXPORT_FROM = /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/;

const namesFromExportList = (listBody: string): string[] =>
  listBody
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const asMatch = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(piece);
      return asMatch ? asMatch[1] : piece.replace(/^type\s+/, '');
    });

const collectExportedNames = (source: string): string[] => {
  const names: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const declaration = EXPORT_DECLARATION.exec(line);
    if (declaration) names.push(declaration[1]);
    const list = EXPORT_LIST.exec(line);
    if (list) names.push(...namesFromExportList(list[1]));
  }
  return names;
};

const exportFromSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = EXPORT_FROM.exec(line);
    if (match) specifiers.push(match[1]);
  }
  return specifiers;
};

const collectSourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|mts|svelte)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

const debugLogMatcher = new RegExp(importPatterns(overrides[0])[0].regex);
const restrictedNames = collectExportedNames(
  readFileSync(fromRoot(registry.boundary.module), 'utf8'),
).filter((name) => !registry.boundary.allowedImportNames.includes(name));

describe('restricted-name census — what lint rules cannot see', () => {
  it('derives the restricted set from the debug-log module itself', () => {
    expect(restrictedNames).toContain('captureGanttLifecycle');
    expect(restrictedNames).toContain('ganttLifecycleControl');
    expect(restrictedNames).toContain('GanttLifecycleFacts');
    expect(restrictedNames).not.toContain('dlog');
    expect(restrictedNames).not.toContain('isGanttDebugEnabled');
  });

  it('census matcher catches laundering shapes and ignores legitimate exports', () => {
    expect(collectExportedNames("export function captureGanttLifecycle(): void {}"))
      .toContain('captureGanttLifecycle');
    expect(collectExportedNames("export { captureGanttLifecycle } from '../debugLog';"))
      .toContain('captureGanttLifecycle');
    expect(collectExportedNames("export { internal as captureGanttLifecycle };"))
      .toContain('captureGanttLifecycle');
    expect(collectExportedNames('export type { GanttLifecycleFacts } from "../debugLog";'))
      .toContain('GanttLifecycleFacts');
    expect(exportFromSpecifiers("export * from '../debugLog';")).toEqual(['../debugLog']);
    expect(collectExportedNames('export function buildLegendCatalog(): void {}'))
      .toEqual(['buildLegendCatalog']);
  });

  it('no source module besides the debug-log module and the seam exports a restricted name', () => {
    const exempt = new Set(
      [registry.boundary.module, registry.boundary.seamModule].map((p) => fromRoot(p)),
    );
    const violations: string[] = [];
    for (const file of collectSourceFiles(fromRoot('src'))) {
      if (exempt.has(resolve(file))) continue;
      const source = readFileSync(file, 'utf8');
      for (const name of collectExportedNames(source)) {
        if (restrictedNames.includes(name)) {
          violations.push(`${file}: exports restricted name ${name}`);
        }
      }
      for (const specifier of exportFromSpecifiers(source)) {
        if (debugLogMatcher.test(specifier)) {
          violations.push(`${file}: re-exports from ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('seam export surface stays inside its declared public names', () => {
    const violationsIn = (source: string): string[] =>
      collectExportedNames(source)
        .filter((name) => restrictedNames.includes(name))
        .filter((name) => !registry.boundary.seamPublicNames.includes(name))
        .map((name) => `seam exports restricted non-public name ${name}`);

    expect(violationsIn("export { GanttLifecycleFacts } from '../debugLog';")).toEqual([]);
    expect(
      violationsIn("export { captureGanttLifecycle } from '../debugLog';"),
    ).toEqual(['seam exports restricted non-public name captureGanttLifecycle']);

    const seamPath = fromRoot(registry.boundary.seamModule);
    if (existsSync(seamPath)) {
      expect(violationsIn(readFileSync(seamPath, 'utf8'))).toEqual([]);
    }
  });
});

describe('junction files carry no inline lint directives', () => {
  const DIRECTIVE =
    /eslint-disable|eslint-enable|eslint-env|\/\*\s*(?:global|globals|exported)\b|\/\*\s*eslint\b/;

  it('directive matcher catches every directive form and ignores prose', () => {
    expect(DIRECTIVE.test('// eslint-disable-next-line no-restricted-imports')).toBe(true);
    expect(DIRECTIVE.test('/* eslint-disable */')).toBe(true);
    expect(DIRECTIVE.test('/* global MouseEvent */')).toBe(true);
    expect(DIRECTIVE.test('/* globals window */')).toBe(true);
    expect(DIRECTIVE.test('/* exported foo */')).toBe(true);
    expect(DIRECTIVE.test('/* eslint no-undef: "off" */')).toBe(true);
    expect(DIRECTIVE.test('// eslint-env node')).toBe(true);
    expect(DIRECTIVE.test('// reads the global sink at teardown')).toBe(false);
    expect(DIRECTIVE.test('const globals = readGlobals();')).toBe(false);
  });

  it('none of the junction files contains a directive', () => {
    const violations: string[] = [];
    for (const file of registry.boundary.files) {
      const lines = readFileSync(fromRoot(file.path), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (DIRECTIVE.test(line)) {
          violations.push(`${file.path}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});

describe('eslint config wires the derived overrides', () => {
  it('spreads deriveBoundaryOverrides() after the svelte block', () => {
    const source = readFileSync(fromRoot('eslint.config.mjs'), 'utf8');
    expect(source).toContain(
      "import { deriveBoundaryOverrides } from './scripts/maintainability-registry.mjs'",
    );
    const svelteBlockIndex = source.indexOf("files: ['**/*.svelte']");
    const spreadIndex = source.indexOf('...deriveBoundaryOverrides()');
    expect(svelteBlockIndex).toBeGreaterThan(-1);
    expect(spreadIndex).toBeGreaterThan(svelteBlockIndex);
  });
});

interface HarnessResult {
  id: string;
  filePath: string;
  expectation: string;
  ok: boolean;
  errorRuleIds: string[];
  errorCount: number;
  warningCount: number;
}

describe('mutation harness — every plant re-proven against the real config', () => {
  const REQUIRED_PLANTS = [
    'junction-value-import-svelte',
    'adapter-deeper-path-import',
    'adapter-type-only-import',
    'inline-disable-still-red',
    'dynamic-import-expression',
    'inline-import-type',
    'lifecycle-global-member',
    'lifecycle-global-bracket-string',
    'lifecycle-global-template-literal',
    'helper-reexport-launders',
    'seam-restricted-import',
    'no-undef-control',
    'allowlisted-dlog-import',
    'declared-globals-still-known',
    'computed-global-name-known-static-limit',
  ];

  it(
    'harness verdicts hold for every required plant',
    () => {
      const run = spawnSync(
        process.execPath,
        ['scripts/maintainability-boundary-mutation-harness.mjs', '--json'],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 240_000 },
      );
      expect(run.error).toBeUndefined();
      const parsed = JSON.parse(run.stdout) as { ok: boolean; results: HarnessResult[] };
      const byId = new Map(parsed.results.map((result) => [result.id, result]));
      for (const id of REQUIRED_PLANTS) {
        expect(byId.has(id)).toBe(true);
      }
      const failing = parsed.results.filter((result) => !result.ok);
      expect(failing).toEqual([]);
      expect(parsed.ok).toBe(true);

      const expectRule = (id: string, rule: string): void => {
        const result = byId.get(id);
        expect(result?.errorRuleIds).toContain(rule);
      };
      expectRule('junction-value-import-svelte', 'no-restricted-imports');
      expectRule('adapter-deeper-path-import', 'no-restricted-imports');
      expectRule('adapter-type-only-import', 'no-restricted-imports');
      expectRule('inline-disable-still-red', 'no-restricted-imports');
      expectRule('dynamic-import-expression', 'no-restricted-syntax');
      expectRule('inline-import-type', 'no-restricted-syntax');
      expectRule('lifecycle-global-member', 'no-restricted-syntax');
      expectRule('lifecycle-global-bracket-string', 'no-restricted-syntax');
      expectRule('lifecycle-global-template-literal', 'no-restricted-syntax');
      expectRule('helper-reexport-launders', 'no-restricted-imports');
      expectRule('seam-restricted-import', 'no-restricted-imports');
      expectRule('no-undef-control', 'no-undef');

      const disablePlant = byId.get('inline-disable-still-red');
      expect(disablePlant && disablePlant.warningCount).toBeGreaterThan(0);

      for (const cleanId of [
        'allowlisted-dlog-import',
        'declared-globals-still-known',
        'computed-global-name-known-static-limit',
      ]) {
        const result = byId.get(cleanId);
        expect(result?.errorCount).toBe(0);
        expect(result?.warningCount).toBe(0);
      }
    },
    300_000,
  );
});
