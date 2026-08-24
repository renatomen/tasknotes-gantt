/**
 * Mutation harness for the placement-boundary lint gate: lints each planted
 * violation as in-memory text against the repo's real ESLint config at the
 * junction files' own paths, so CI re-proves the gate on every run without a
 * lint-invalid file ever being committed. The negative plants pin the gate's
 * intended pass-throughs, including the documented static limit (a computed
 * global name cannot be caught by static selectors).
 *
 * Direct run prints a verdict table and exits non-zero on any miss;
 * `--json` prints the machine-readable results consumed by the unit test.
 */
import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readRegistry } from './maintainability-registry.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {{
 *   id: string,
 *   filePath: string,
 *   code: string,
 *   expectRule?: string,
 *   expectWarning?: boolean,
 *   expectClean?: boolean,
 * }} Plant
 */

/**
 * @param {ReturnType<typeof readRegistry>} registry
 * @param {string} suffix
 * @returns {string}
 */
function boundaryPath(registry, suffix) {
  const entry = registry.boundary.files.find((file) => file.path.endsWith(suffix));
  if (!entry) throw new Error(`boundary file matching ${suffix} not found in the registry`);
  return entry.path;
}

/** @returns {Plant[]} */
function buildPlants() {
  const registry = readRegistry();
  const container = boundaryPath(registry, 'GanttContainer.svelte');
  const register = boundaryPath(registry, 'register.ts');
  const controller = boundaryPath(registry, 'GanttController.ts');
  const adapter = boundaryPath(registry, 'BasesDataAdapter.ts');
  const globalName = registry.boundary.lifecycleGlobal;
  return [
    {
      id: 'junction-value-import-svelte',
      filePath: container,
      code: [
        '<script lang="ts">',
        "  import { ganttLifecycleControl } from '../debugLog';",
        '  void ganttLifecycleControl;',
        '</script>',
      ].join('\n'),
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'adapter-deeper-path-import',
      filePath: adapter,
      code: "import { ganttLifecycleControl } from '../../debugLog';\nvoid ganttLifecycleControl;\n",
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'adapter-type-only-import',
      filePath: adapter,
      code: [
        "import type { ViewportObservation } from '../../debugLog';",
        'const observation: ViewportObservation | null = null;',
        'void observation;',
        '',
      ].join('\n'),
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'inline-disable-still-red',
      filePath: register,
      code: [
        '// eslint-disable-next-line no-restricted-imports',
        "import { classifyViewportSettlement } from '../debugLog';",
        'void classifyViewportSettlement;',
        '',
      ].join('\n'),
      expectRule: 'no-restricted-imports',
      expectWarning: true,
    },
    {
      id: 'dynamic-import-expression',
      filePath: register,
      code: "export async function loadDiagnostics(): Promise<unknown> {\n  return import('../debugLog');\n}\n",
      expectRule: 'no-restricted-syntax',
    },
    {
      id: 'inline-import-type',
      filePath: container,
      code: [
        '<script lang="ts">',
        "  type FactsAlias = import('../debugLog').GanttLifecycleFacts;",
        '  const facts: FactsAlias | null = null;',
        '  void facts;',
        '</script>',
      ].join('\n'),
      expectRule: 'no-restricted-syntax',
    },
    {
      id: 'lifecycle-global-member',
      filePath: register,
      code: `export function probeSink(): unknown {\n  return globalThis.${globalName};\n}\n`,
      expectRule: 'no-restricted-syntax',
    },
    {
      id: 'lifecycle-global-bracket-string',
      filePath: register,
      code: `export function probeSinkByKey(): unknown {\n  return (globalThis as unknown as Record<string, unknown>)['${globalName}'];\n}\n`,
      expectRule: 'no-restricted-syntax',
    },
    {
      id: 'lifecycle-global-template-literal',
      filePath: register,
      code: `export function probeSinkByTemplate(): unknown {\n  return (globalThis as unknown as Record<string, unknown>)[\`${globalName}\`];\n}\n`,
      expectRule: 'no-restricted-syntax',
    },
    {
      id: 'helper-reexport-launders',
      filePath: 'src/bases/lifecycleRelay.ts',
      code: "export { captureGanttLifecycle } from '../debugLog';\n",
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'seam-restricted-import',
      filePath: controller,
      code: "import { internalLifecycleState } from '../bases/ganttLifecycleDiagnostics';\nvoid internalLifecycleState;\n",
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'junction-js-extension-import',
      filePath: register,
      code: "import { classifyViewportSettlement } from '../debugLog.js';\nvoid classifyViewportSettlement;\n",
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'junction-ts-extension-import',
      filePath: register,
      code: "import { classifyViewportSettlement } from '../debugLog.ts';\nvoid classifyViewportSettlement;\n",
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'seam-js-extension-import',
      filePath: controller,
      code: "import { internalLifecycleState } from '../bases/ganttLifecycleDiagnostics.js';\nvoid internalLifecycleState;\n",
      expectRule: 'no-restricted-imports',
    },
    {
      id: 'helper-dynamic-import',
      filePath: 'src/bases/lifecycleRelay.ts',
      code: "export async function relayDiagnostics(): Promise<unknown> {\n  return import('../debugLog');\n}\n",
      expectRule: 'no-restricted-syntax',
    },
    {
      id: 'helper-lifecycle-global-access',
      filePath: 'src/bases/lifecycleRelay.ts',
      code: `export function relaySink(): unknown {\n  return (globalThis as unknown as Record<string, unknown>)['${globalName}'];\n}\n`,
      expectRule: 'no-restricted-syntax',
    },
    {
      id: 'no-undef-control',
      filePath: register,
      code: 'export function probeUndeclared(): unknown {\n  return new SomeUndeclaredGlobalCtor();\n}\n',
      expectRule: 'no-undef',
    },
    {
      id: 'allowlisted-dlog-import',
      filePath: register,
      code: "import { dlog } from '../debugLog';\ndlog('boundary probe');\n",
      expectClean: true,
    },
    {
      id: 'declared-globals-still-known',
      filePath: register,
      code: 'export function readButton(event: MouseEvent): number {\n  return event.button;\n}\n',
      expectClean: true,
    },
    {
      id: 'computed-global-name-known-static-limit',
      filePath: register,
      code: [
        "const computedKey = '__tnGantt' + 'Lifecycle';",
        'export function probeComputedSink(): unknown {',
        '  return (globalThis as unknown as Record<string, unknown>)[computedKey];',
        '}',
        '',
      ].join('\n'),
      expectClean: true,
    },
  ];
}

/**
 * @param {Plant} plant
 * @param {{ errorRuleIds: string[], errorCount: number, warningCount: number }} outcome
 * @returns {boolean}
 */
function verdictHolds(plant, outcome) {
  if (plant.expectClean) return outcome.errorCount === 0 && outcome.warningCount === 0;
  const ruleHit = plant.expectRule ? outcome.errorRuleIds.includes(plant.expectRule) : false;
  const warningHolds = plant.expectWarning ? outcome.warningCount > 0 : true;
  return ruleHit && warningHolds;
}

export async function runBoundaryMutationChecks() {
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await Promise.all(
    buildPlants().map(async (plant) => {
      const [lintResult] = await eslint.lintText(plant.code, {
        filePath: join(repoRoot, plant.filePath),
        warnIgnored: true,
      });
      const outcome = {
        errorRuleIds: lintResult.messages
          .filter((message) => message.severity === 2)
          .map((message) => message.ruleId ?? 'fatal'),
        errorCount: lintResult.errorCount,
        warningCount: lintResult.warningCount,
      };
      return {
        id: plant.id,
        filePath: plant.filePath,
        expectation: plant.expectClean ? 'clean' : `red:${plant.expectRule}`,
        ok: verdictHolds(plant, outcome),
        ...outcome,
      };
    }),
  );
  return { ok: results.every((result) => result.ok), results };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const asJson = process.argv.includes('--json');
  runBoundaryMutationChecks()
    .then((report) => {
      if (asJson) {
        console.log(JSON.stringify(report));
      } else {
        for (const result of report.results) {
          const rules = result.errorRuleIds.join(',') || '-';
          console.log(
            `${result.ok ? 'PASS' : 'FAIL'}  ${result.id}  [${result.expectation}]  ` +
              `errors=${result.errorCount}(${rules}) warnings=${result.warningCount}`,
          );
        }
        console.log(report.ok ? 'boundary mutation checks: all verdicts hold' : 'boundary mutation checks: MISS');
      }
      process.exit(report.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error('boundary mutation harness crashed:', error);
      process.exit(1);
    });
}
