/**
 * Single reader for `maintainability-registry.json` (repo root): the committed
 * source for the ranked-file list, the measurement baseline, the dated trend
 * reports, and the placement-boundary configuration. The ESLint config derives
 * its per-file boundary overrides from here, and the trend tooling reads the
 * same registry through this module — one source, one derivation.
 *
 * A malformed registry throws at read time, so a bad edit fails the lint gate
 * itself instead of silently deriving an override that matches nothing.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const REGISTRY_PATH = join(repoRoot, 'maintainability-registry.json');

/**
 * @typedef {{ path: string, rank: number }} RankedFile
 * @typedef {{ delta: string, whyNotSeam: string, alternatives: string, approval: string }} AllowanceRecord
 * @typedef {{ file: string, importName: string, dated: string, removedBy: string, record: AllowanceRecord }} Allowance
 * @typedef {{ path: string, globals: string[] }} BoundaryFile
 * @typedef {{
 *   module: string,
 *   seamModule: string,
 *   seamPublicNames: string[],
 *   allowedImportNames: string[],
 *   lifecycleGlobal: string,
 *   files: BoundaryFile[],
 *   allowances: Allowance[],
 * }} Boundary
 * @typedef {{ date: string, anchorSha: string, concernCounts?: Record<string, number> }} TrendReport
 * @typedef {{
 *   baseline: { sha: string, date: string, report: string },
 *   rankedFiles: RankedFile[],
 *   reports: TrendReport[],
 *   boundary: Boundary,
 * }} MaintainabilityRegistry
 */

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`maintainability-registry: ${message}`);
}

/** @param {unknown} value @returns {value is string} */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** @param {MaintainabilityRegistry} registry */
function validateBaseline(registry) {
  const { baseline } = registry;
  if (!baseline || !/^[0-9a-f]{40}$/.test(baseline.sha ?? '')) {
    fail('baseline.sha must be a 40-character lowercase hex sha');
  }
  if (!isNonEmptyString(baseline.date)) fail('baseline.date must be a date string');
  if (!isNonEmptyString(baseline.report)) fail('baseline.report must name the baseline report');
}

/** @param {MaintainabilityRegistry} registry */
function validateRankedFiles(registry) {
  const { rankedFiles } = registry;
  if (!Array.isArray(rankedFiles) || rankedFiles.length === 0) {
    fail('rankedFiles must be a non-empty array');
  }
  const seen = new Set();
  for (const entry of rankedFiles) {
    if (!isNonEmptyString(entry.path)) fail('rankedFiles entry is missing a path');
    if (!Number.isInteger(entry.rank) || entry.rank < 1) {
      fail(`rankedFiles entry ${entry.path} is missing a positive integer rank`);
    }
    if (seen.has(entry.path)) fail(`duplicate rankedFiles path ${entry.path}`);
    seen.add(entry.path);
  }
}

/** @param {MaintainabilityRegistry} registry */
function validateBoundaryShape(registry) {
  const { boundary } = registry;
  if (!boundary) fail('boundary section is missing');
  if (!isNonEmptyString(boundary.module)) fail('boundary.module must be a path');
  if (!isNonEmptyString(boundary.seamModule)) fail('boundary.seamModule must be a path');
  if (!Array.isArray(boundary.seamPublicNames) || boundary.seamPublicNames.length === 0) {
    fail('boundary.seamPublicNames must be a non-empty array');
  }
  if (!Array.isArray(boundary.allowedImportNames) || boundary.allowedImportNames.length === 0) {
    fail('boundary.allowedImportNames must be a non-empty array');
  }
  if (!isNonEmptyString(boundary.lifecycleGlobal)) {
    fail('boundary.lifecycleGlobal must name the sink global');
  }
}

/** @param {MaintainabilityRegistry} registry */
function validateBoundaryFiles(registry) {
  const { boundary, rankedFiles } = registry;
  if (!Array.isArray(boundary.files) || boundary.files.length === 0) {
    fail('boundary.files must be a non-empty array');
  }
  const rankedPaths = new Set(rankedFiles.map((entry) => entry.path));
  const seen = new Set();
  for (const file of boundary.files) {
    if (!isNonEmptyString(file.path)) fail('boundary.files entry is missing a path');
    if (!rankedPaths.has(file.path)) {
      fail(`boundary file ${file.path} is not a ranked entry; junction files must stay ranked`);
    }
    if (!Array.isArray(file.globals) || file.globals.some((name) => !isNonEmptyString(name))) {
      fail(`boundary file ${file.path} must carry a globals array of names`);
    }
    if (seen.has(file.path)) fail(`duplicate boundary file ${file.path}`);
    seen.add(file.path);
  }
}

/** @param {Allowance} allowance */
function validateAllowanceRecord(allowance) {
  const label = `allowance ${allowance.file} -> ${allowance.importName}`;
  if (!isNonEmptyString(allowance.dated)) fail(`${label} is missing its dated field`);
  if (!isNonEmptyString(allowance.removedBy)) fail(`${label} is missing its removedBy field`);
  const record = allowance.record;
  if (!record) fail(`${label} is missing its record`);
  for (const field of ['delta', 'whyNotSeam', 'alternatives', 'approval']) {
    if (!isNonEmptyString(record[field])) fail(`${label} record is missing its ${field} field`);
  }
}

/** @param {MaintainabilityRegistry} registry */
function validateAllowances(registry) {
  const { boundary } = registry;
  if (!Array.isArray(boundary.allowances)) fail('boundary.allowances must be an array');
  const boundaryPaths = new Set(boundary.files.map((file) => file.path));
  const allowed = new Set(boundary.allowedImportNames);
  const seen = new Set();
  for (const allowance of boundary.allowances) {
    if (!isNonEmptyString(allowance.importName)) fail('allowance is missing an importName');
    if (!boundaryPaths.has(allowance.file)) {
      fail(`allowance for ${allowance.file} names a file outside the boundary set`);
    }
    if (allowed.has(allowance.importName)) {
      fail(`allowance ${allowance.importName} duplicates the base allowlist`);
    }
    const key = `${allowance.file} -> ${allowance.importName}`;
    if (seen.has(key)) fail(`duplicate allowance ${key}`);
    seen.add(key);
    validateAllowanceRecord(allowance);
  }
}

/**
 * Schema validation only: filesystem-dependent invariants (paths exist on
 * disk, the allowance/seam handshake) live in the registry test, which sees
 * the working tree this registry describes.
 *
 * @param {MaintainabilityRegistry} registry
 * @returns {MaintainabilityRegistry}
 */
export function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object') fail('registry must be a JSON object');
  validateBaseline(registry);
  validateRankedFiles(registry);
  if (!Array.isArray(registry.reports)) fail('reports must be an array');
  validateBoundaryShape(registry);
  validateBoundaryFiles(registry);
  validateAllowances(registry);
  return registry;
}

/** @returns {MaintainabilityRegistry} */
export function readRegistry() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (error) {
    fail(`cannot read ${REGISTRY_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateRegistry(parsed);
}

/**
 * The allowance/seam handshake: interim allowances exist exactly while the
 * seam module does not. Once the seam lands, every allowance must be retired
 * in the same change; retiring them earlier would leave the junction imports
 * red with nowhere to move.
 *
 * @param {MaintainabilityRegistry} registry
 * @param {boolean} seamExists
 * @returns {string[]}
 */
export function allowanceStateViolations(registry, seamExists) {
  const { allowances, seamModule } = registry.boundary;
  if (seamExists) {
    return allowances.map(
      (allowance) =>
        `allowance ${allowance.file} -> ${allowance.importName} must be removed: ` +
        `the seam module ${seamModule} exists`,
    );
  }
  if (allowances.length === 0) {
    return [
      `boundary has no interim allowances but the seam module ${seamModule} does not exist; ` +
        'retire allowances only together with the seam',
    ];
  }
  return [];
}

/** @param {string} modulePath @returns {string} */
function moduleBaseName(modulePath) {
  return basename(modulePath, '.ts');
}

const BOUNDARY_MESSAGE =
  'Lifecycle diagnostics live behind the seam module; junction files import only allowlisted ' +
  'names. A new import needs a dated allowance entry with its record in ' +
  'maintainability-registry.json (AGENTS.md, Review guidelines).';

/**
 * @param {Boundary} boundary
 * @param {BoundaryFile} file
 */
function junctionOverride(boundary, file) {
  const moduleRegex = `(^|[\\/])${moduleBaseName(boundary.module)}(\\.ts)?$`;
  const seamRegex = `(^|[\\/])${moduleBaseName(boundary.seamModule)}(\\.ts)?$`;
  const esqueryModuleRegex = `(^|\\u002F)${moduleBaseName(boundary.module)}(\\.ts)?$`;
  const allowedForFile = [
    ...boundary.allowedImportNames,
    ...boundary.allowances
      .filter((allowance) => allowance.file === file.path)
      .map((allowance) => allowance.importName),
  ];
  return {
    files: [file.path],
    linterOptions: { noInlineConfig: true },
    languageOptions: {
      globals: Object.fromEntries(file.globals.map((name) => [name, 'readonly'])),
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: moduleRegex, allowImportNames: allowedForFile, message: BOUNDARY_MESSAGE },
            {
              regex: seamRegex,
              allowImportNames: boundary.seamPublicNames,
              message:
                'Only the seam module’s declared public names may be imported from it.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression > Literal[value=/${esqueryModuleRegex}/]`,
          message: BOUNDARY_MESSAGE,
        },
        {
          selector: `TSImportType Literal[value=/${esqueryModuleRegex}/]`,
          message: BOUNDARY_MESSAGE,
        },
        {
          selector: `Identifier[name="${boundary.lifecycleGlobal}"]`,
          message: `The ${boundary.lifecycleGlobal} sink is owned by the debug-log module; junction files never touch it.`,
        },
        {
          selector: `Literal[value=/${boundary.lifecycleGlobal}/]`,
          message: `The ${boundary.lifecycleGlobal} sink is owned by the debug-log module; junction files never touch it.`,
        },
        {
          selector: `TemplateElement[value.cooked=/${boundary.lifecycleGlobal}/]`,
          message: `The ${boundary.lifecycleGlobal} sink is owned by the debug-log module; junction files never touch it.`,
        },
      ],
    },
  };
}

/**
 * Derives the boundary's flat-config override objects, ready to spread into
 * `eslint.config.mjs` after the svelte block:
 *
 * 1. A source-tree closure entry: every `src/` module except the debug-log
 *    module and the seam may import only the base allowlist from the debug-log
 *    module — a helper cannot launder a restricted name to a junction file.
 * 2. One entry per junction file: the allowlist plus that file's dated
 *    allowances, the seam's public-name bound, the dynamic-import and
 *    lifecycle-global syntax rules, `noInlineConfig`, and its declared globals.
 *
 * @param {MaintainabilityRegistry} [registry]
 */
export function deriveBoundaryOverrides(registry = readRegistry()) {
  const { boundary } = registry;
  const moduleRegex = `(^|[\\/])${moduleBaseName(boundary.module)}(\\.ts)?$`;
  const closure = {
    files: ['src/**/*.{ts,mts,svelte}'],
    ignores: [boundary.module, boundary.seamModule],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: moduleRegex,
              allowImportNames: [...boundary.allowedImportNames],
              message: BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  };
  return [closure, ...boundary.files.map((file) => junctionOverride(boundary, file))];
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const registry = readRegistry();
  const overrides = deriveBoundaryOverrides(registry);
  console.log(
    `maintainability-registry: ${registry.rankedFiles.length} ranked files, ` +
      `${registry.boundary.files.length} junction files, ` +
      `${registry.boundary.allowances.length} interim allowances, ` +
      `${overrides.length} derived overrides`,
  );
}
