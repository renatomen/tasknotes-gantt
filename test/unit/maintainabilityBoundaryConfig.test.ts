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
const overrides = deriveBoundaryOverrides(registry) as unknown as DerivedOverride[];
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
    expect(overrides[0].files).toEqual(['src/**/*.{ts,tsx,mts,cts,svelte,js,mjs,cjs}']);
    expect(overrides[0].ignores).toEqual([
      registry.boundary.module,
      registry.boundary.seamModule,
    ]);
    registry.boundary.files.forEach((file, index) => {
      expect(overrides[index + 1].files).toEqual([file.path]);
    });
  });

  it('closure entry restricts the whole source tree to the base allowlist and seam surface', () => {
    const patterns = importPatterns(overrides[0]);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].allowImportNames).toEqual(registry.boundary.allowedImportNames);
    expect(patterns[1].allowImportNames).toEqual(registry.boundary.seamPublicNames);
  });

  it('junction syntax rules are the closure rules plus the blanket dynamic-import ban', () => {
    const closureSelectors = syntaxSelectors(overrides[0]);
    for (const [index] of registry.boundary.files.entries()) {
      expect(syntaxSelectors(overrides[index + 1])).toEqual([
        ...closureSelectors,
        'ImportExpression',
      ]);
    }
  });

  it('closure and junction entries derive one identical debug-log matcher', () => {
    const closureRegex = importPatterns(overrides[0])[0].regex;
    for (const [index] of registry.boundary.files.entries()) {
      expect(importPatterns(overrides[index + 1])[0].regex).toEqual(closureRegex);
    }
  });

  it('matches the debug-log module at any relative depth, with every resolvable extension', () => {
    const matcher = new RegExp(importPatterns(overrides[0])[0].regex);
    for (const specifier of [
      '../debugLog',
      '../../debugLog',
      '../debugLog.ts',
      '../debugLog.js',
      '../debugLog.mjs',
      '../debugLog.mts',
      '../../../debugLog.ts',
      'src/debugLog',
    ]) {
      expect(specifier).toMatch(matcher);
    }
    for (const specifier of [
      '../debugLogUtils',
      '../debugLogUtils.js',
      './svarContract',
      '../render/debugLogger',
    ]) {
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
      expect('./ganttLifecycleDiagnostics.js').toMatch(matcher);
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

  it('derives live from the registry: an allowance entry adds the allowed name, its absence drops it', () => {
    // The committed registry carries no allowances (the seam exists), so
    // liveness is proven by planting one and watching the derived name appear.
    const mutated = JSON.parse(JSON.stringify(registry)) as Registry;
    mutated.boundary.allowances = [
      {
        file: 'src/bases/register.ts',
        importName: 'captureGanttLifecycle',
        dated: '2026-08-25',
        removedBy: 'synthetic-test-fixture',
        record: {
          delta: 'synthetic test fixture',
          whyNotSeam: 'proves the allowance derivation stays live',
          alternatives: 'none',
          approval: 'not applicable: in-memory fixture',
        },
      },
    ];
    const derived = deriveBoundaryOverrides(mutated) as unknown as DerivedOverride[];
    const registerIndex =
      1 + registry.boundary.files.findIndex((file) => file.path === 'src/bases/register.ts');
    expect(importPatterns(derived[registerIndex])[0].allowImportNames).toContain(
      'captureGanttLifecycle',
    );
    expect(importPatterns(overrides[registerIndex])[0].allowImportNames).not.toContain(
      'captureGanttLifecycle',
    );
  });
});

/**
 * Exported-name census helpers (shared by the re-export and seam-bound
 * guards). Whole-source multiline scans, not per-line: an export list that
 * spans lines (the repo's barrel style) must not evade the census.
 */
const EXPORT_DECLARATION =
  /^[ \t]*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^[ \t]*export\s+(?:type\s+)?\{([^}]*)\}/gm;
const EXPORT_FROM =
  /^[ \t]*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm;

// Records BOTH sides of an alias: `captureGanttLifecycle as default` must
// surface the restricted original, not just the innocuous exported name.
const namesFromExportList = (listBody: string): string[] =>
  listBody
    .split(',')
    .map((piece) => piece.trim().replace(/^type\s+/, ''))
    .filter((piece) => piece.length > 0)
    .flatMap((piece) => {
      const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(piece);
      return asMatch ? [asMatch[1], asMatch[2]] : [piece];
    });

// Comments inside export syntax (`export { /* bridge */ name }`) must not
// blind the census; specifiers never contain strings, so stripping is safe
// for the export patterns these scans match (worst case it over-matches,
// which fails loud).
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const collectExportedNames = (rawSource: string): string[] => {
  const source = stripComments(rawSource);
  const names: string[] = [];
  for (const match of source.matchAll(EXPORT_DECLARATION)) names.push(match[1]);
  for (const match of source.matchAll(EXPORT_LIST)) names.push(...namesFromExportList(match[1]));
  return names;
};

const exportFromSpecifiers = (rawSource: string): string[] =>
  [...stripComments(rawSource).matchAll(EXPORT_FROM)].map((match) => match[1]);

const collectSourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|mts|cts|svelte|js|mjs|cjs)$/.test(entry)) {
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

    const multiLine = "export {\n  internal as captureGanttLifecycle,\n} from '../debugLog';\n";
    expect(collectExportedNames(multiLine)).toContain('captureGanttLifecycle');
    expect(exportFromSpecifiers(multiLine)).toEqual(['../debugLog']);
    expect(collectExportedNames('export default function captureGanttLifecycle(): void {}'))
      .toContain('captureGanttLifecycle');
    expect(exportFromSpecifiers("export * as diagnostics from '../debugLog';"))
      .toEqual(['../debugLog']);
    expect(collectExportedNames('export { /* bridge */ captureGanttLifecycle };'))
      .toContain('captureGanttLifecycle');
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
    const STAR_EXPORT = /^[ \t]*export\s+\*(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*from\s*['"]([^'"]+)['"]/gm;
    const violationsIn = (source: string): string[] => [
      ...collectExportedNames(source)
        .filter((name) => restrictedNames.includes(name))
        .filter((name) => !registry.boundary.seamPublicNames.includes(name))
        .map((name) => `seam exports restricted non-public name ${name}`),
      ...[...source.matchAll(STAR_EXPORT)]
        .map((match) => match[1])
        .filter((specifier) => debugLogMatcher.test(specifier))
        .map((specifier) => `seam star-exports the debug-log module (${specifier}); re-export named public types only`),
    ];

    expect(violationsIn("export { GanttLifecycleFacts } from '../debugLog';")).toEqual([]);
    expect(
      violationsIn("export { captureGanttLifecycle } from '../debugLog';"),
    ).toEqual(['seam exports restricted non-public name captureGanttLifecycle']);
    expect(violationsIn("export * from '../debugLog';")).toEqual([
      "seam star-exports the debug-log module (../debugLog); re-export named public types only",
    ]);
    expect(violationsIn("export * as diagnostics from '../debugLog.js';")).toEqual([
      "seam star-exports the debug-log module (../debugLog.js); re-export named public types only",
    ]);
    expect(violationsIn("export * from './legendLayout';")).toEqual([]);
    expect(violationsIn("export { captureGanttLifecycle as default } from '../debugLog';")).toEqual(
      ['seam exports restricted non-public name captureGanttLifecycle'],
    );

    const seamPath = fromRoot(registry.boundary.seamModule);
    if (existsSync(seamPath)) {
      expect(violationsIn(readFileSync(seamPath, 'utf8'))).toEqual([]);
    }
  });

  it('no source module suppresses the boundary rules with a disable directive', () => {
    // The four junction files refuse all directives via noInlineConfig; the
    // rest of the source tree may keep rule-named directives for other rules,
    // but a directive naming a boundary rule - or a bare disable-everything -
    // would suppress the closure entry, so both are refused here.
    const BOUNDARY_RULE_DISABLE = /eslint[^\n]*no-restricted-(?:imports|syntax)/;
    const BARE_DISABLE =
      /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?(?:\s*--[^*\n]*?)?\s*(?:\*\/\s*)?$/;

    expect(BOUNDARY_RULE_DISABLE.test('// eslint-disable-next-line no-restricted-imports')).toBe(true);
    expect(BOUNDARY_RULE_DISABLE.test('/* eslint-disable no-restricted-syntax */')).toBe(true);
    expect(BOUNDARY_RULE_DISABLE.test('/* eslint no-restricted-imports: "off" */')).toBe(true);
    expect(BOUNDARY_RULE_DISABLE.test('/* eslint no-restricted-syntax: 0 */')).toBe(true);
    expect(BOUNDARY_RULE_DISABLE.test('// eslint-disable-next-line @typescript-eslint/no-explicit-any')).toBe(false);
    expect(BARE_DISABLE.test('/* eslint-disable */')).toBe(true);
    expect(BARE_DISABLE.test('// eslint-disable-next-line')).toBe(true);
    expect(BARE_DISABLE.test('/* eslint-disable -- temporary bridge */')).toBe(true);
    expect(BARE_DISABLE.test('// eslint-disable-next-line -- reason')).toBe(true);
    expect(BARE_DISABLE.test('// eslint-disable-next-line @typescript-eslint/no-explicit-any')).toBe(false);
    expect(
      BARE_DISABLE.test('// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason'),
    ).toBe(false);

    // Block comments are directives as a whole, however many lines they span,
    // so each is tested whitespace-normalized in addition to the line scan.
    const wholeBlockComments = (source: string): string[] =>
      [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) =>
        match[0].replace(/\s+/g, ' '),
      );
    expect(
      wholeBlockComments('/* eslint\n   no-restricted-imports: "off" */').some((comment) =>
        BOUNDARY_RULE_DISABLE.test(comment),
      ),
    ).toBe(true);
    expect(
      wholeBlockComments('/* eslint-disable\n*/').some((comment) => BARE_DISABLE.test(comment)),
    ).toBe(true);

    const violations: string[] = [];
    for (const file of collectSourceFiles(fromRoot('src'))) {
      const source = readFileSync(file, 'utf8');
      source.split(/\r?\n/).forEach((line, index) => {
        if (BOUNDARY_RULE_DISABLE.test(line) || BARE_DISABLE.test(line)) {
          violations.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
      for (const comment of wholeBlockComments(source)) {
        if (BOUNDARY_RULE_DISABLE.test(comment) || BARE_DISABLE.test(comment)) {
          violations.push(`${file}: block comment ${comment.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
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
    'junction-js-extension-import',
    'junction-ts-extension-import',
    'seam-js-extension-import',
    'helper-dynamic-import',
    'helper-lifecycle-global-access',
    'junction-computed-dynamic-import',
    'helper-computed-dynamic-import',
    'tsx-reexport-launders',
    'helper-seam-default-reexport',
    'junction-side-effect-import',
    'helper-side-effect-import',
    'registry-live-allowance-permits',
    'registry-dropped-allowance-refuses',
    'cross-file-allowance-does-not-leak',
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
      expectRule('junction-js-extension-import', 'no-restricted-imports');
      expectRule('junction-ts-extension-import', 'no-restricted-imports');
      expectRule('seam-js-extension-import', 'no-restricted-imports');
      expectRule('helper-dynamic-import', 'no-restricted-syntax');
      expectRule('helper-lifecycle-global-access', 'no-restricted-syntax');
      expectRule('junction-computed-dynamic-import', 'no-restricted-syntax');
      expectRule('helper-computed-dynamic-import', 'no-restricted-syntax');
      expectRule('tsx-reexport-launders', 'no-restricted-imports');
      expectRule('helper-seam-default-reexport', 'no-restricted-imports');
      expectRule('junction-side-effect-import', 'no-restricted-syntax');
      expectRule('helper-side-effect-import', 'no-restricted-syntax');
      expectRule('registry-dropped-allowance-refuses', 'no-restricted-imports');
      expectRule('cross-file-allowance-does-not-leak', 'no-restricted-imports');
      const liveAllowance = byId.get('registry-live-allowance-permits');
      expect(liveAllowance?.errorCount).toBe(0);
      expect(liveAllowance?.warningCount).toBe(0);
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
