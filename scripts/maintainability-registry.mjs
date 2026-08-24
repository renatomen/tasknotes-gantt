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
 * @typedef {{ date: string, anchorSha: string, report: string, concernCounts?: Record<string, number>, atCeiling?: number }} TrendReport
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

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** @param {MaintainabilityRegistry} registry */
function validateBaseline(registry) {
  const { baseline } = registry;
  if (!baseline || !FULL_SHA_PATTERN.test(baseline.sha ?? '')) {
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

/**
 * The trend script prints "latest report" facts straight from these entries,
 * so a malformed one must fail here — at the same read every consumer shares —
 * rather than mislabel the measurement.
 *
 * @param {MaintainabilityRegistry} registry
 */
function validateReports(registry) {
  const { reports } = registry;
  if (!Array.isArray(reports)) fail('reports must be an array');
  for (const report of reports) {
    // Full ISO date, zero-padded and calendar-real: latest-report selection
    // orders these lexicographically, and the trend output prints them as
    // authoritative — '2026-8-16' would mis-sort, '2026-99-99' would print.
    const dateParts = /^\d{4}-(\d{2})-(\d{2})$/.exec(report.date ?? '');
    if (
      dateParts === null ||
      Number(dateParts[1]) < 1 ||
      Number(dateParts[1]) > 12 ||
      Number(dateParts[2]) < 1 ||
      Number(dateParts[2]) > 31
    ) {
      fail('reports entry date must be a real, zero-padded YYYY-MM-DD string');
    }
    if (!FULL_SHA_PATTERN.test(report.anchorSha ?? '')) {
      fail(`reports entry ${report.date} needs a 40-character lowercase hex anchorSha`);
    }
    if (!isNonEmptyString(report.report)) {
      fail(`reports entry ${report.date} must name its dated report file`);
    }
    const measured = Object.entries(report.concernCounts ?? {}).map(([key, value]) => [
      `concernCounts.${key}`,
      value,
    ]);
    if (report.atCeiling !== undefined) measured.push(['atCeiling', report.atCeiling]);
    for (const [label, value] of measured) {
      if (!Number.isInteger(value) || value < 0) {
        fail(`reports entry ${report.date} ${label} must be a non-negative integer`);
      }
    }
  }
}

/** @param {MaintainabilityRegistry} registry */
function validateBoundaryShape(registry) {
  const { boundary } = registry;
  if (!boundary) fail('boundary section is missing');
  if (!isNonEmptyString(boundary.module) || !/^[\w./-]+$/.test(boundary.module)) {
    fail('boundary.module must be a plain path (word characters, dots, slashes)');
  }
  if (!isNonEmptyString(boundary.seamModule) || !/^[\w./-]+$/.test(boundary.seamModule)) {
    fail('boundary.seamModule must be a plain path (word characters, dots, slashes)');
  }
  if (!Array.isArray(boundary.seamPublicNames) || boundary.seamPublicNames.length === 0) {
    fail('boundary.seamPublicNames must be a non-empty array');
  }
  if (!Array.isArray(boundary.allowedImportNames) || boundary.allowedImportNames.length === 0) {
    fail('boundary.allowedImportNames must be a non-empty array');
  }
  // The base allowlist is the plan-decided pair of gated logging helpers.
  // Widening it would let a lifecycle-capture name into every junction file
  // without a dated allowance, so any change must also change this validator.
  const BASE_ALLOWLIST = ['dlog', 'isGanttDebugEnabled'];
  if (
    boundary.allowedImportNames.length !== BASE_ALLOWLIST.length ||
    BASE_ALLOWLIST.some((name) => !boundary.allowedImportNames.includes(name))
  ) {
    fail(
      'boundary.allowedImportNames must be exactly the base logging allowlist ' +
        `[${BASE_ALLOWLIST.join(', ')}]; new names need a dated per-file allowance instead`,
    );
  }
  if (
    !isNonEmptyString(boundary.lifecycleGlobal) ||
    !/^[A-Za-z_$][\w$]*$/.test(boundary.lifecycleGlobal)
  ) {
    fail('boundary.lifecycleGlobal must be a plain identifier naming the sink global');
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
  validateReports(registry);
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

// TypeScript bundler resolution and Vite map extension-carrying specifiers
// ('../debugLog.js') onto the same .ts module, so the boundary must match
// every resolvable extension, not just the literal one.
const SPECIFIER_EXTENSIONS = '(ts|js|mts|mjs|cts|cjs)';

/** @param {string} modulePath @returns {string} */
function moduleSpecifierRegex(modulePath) {
  return `(^|[\\/])${moduleBaseName(modulePath)}(\\.${SPECIFIER_EXTENSIONS})?$`;
}

/** Same match, escaped for an esquery attribute regex. @param {string} modulePath */
function esquerySpecifierRegex(modulePath) {
  return `(^|\\u002F)${moduleBaseName(modulePath)}(\\.${SPECIFIER_EXTENSIONS})?$`;
}

const BOUNDARY_MESSAGE =
  'Lifecycle diagnostics live behind the seam module; junction files import only allowlisted ' +
  'names. A new import needs a dated allowance entry with its record in ' +
  'maintainability-registry.json (AGENTS.md, Review guidelines).';

/**
 * The syntax half of the boundary — dynamic imports and inline import types of
 * the debug-log module, and any static mention of the lifecycle sink global.
 * Shared verbatim by the junction overrides and the source-tree closure, so a
 * helper module cannot reach diagnostics through a form the junctions forbid.
 *
 * @param {Boundary} boundary
 */
function boundarySyntaxRules(boundary) {
  const esqueryModuleRegex = esquerySpecifierRegex(boundary.module);
  const sinkMessage =
    `The ${boundary.lifecycleGlobal} sink is owned by the debug-log module; ` +
    'no other source module touches it.';
  return [
    'error',
    {
      // A bare side-effect import has no named specifiers for the allowlist
      // rule to check, yet executing the module arms the diagnostics sink.
      selector: `ImportDeclaration[specifiers.length=0] > Literal[value=/${esqueryModuleRegex}/]`,
      message: BOUNDARY_MESSAGE,
    },
    {
      selector: `ImportExpression > Literal[value=/${esqueryModuleRegex}/]`,
      message: BOUNDARY_MESSAGE,
    },
    {
      // A computed specifier cannot be statically resolved, bundled, or
      // boundary-checked; a literal one is checked by the selector above.
      selector: 'ImportExpression[source.type!="Literal"]',
      message:
        'Dynamic imports need a literal specifier: a computed one cannot be ' +
        'statically bundled or boundary-checked.',
    },
    {
      selector: `TSImportType Literal[value=/${esqueryModuleRegex}/]`,
      message: BOUNDARY_MESSAGE,
    },
    { selector: `Identifier[name="${boundary.lifecycleGlobal}"]`, message: sinkMessage },
    { selector: `Literal[value=/${boundary.lifecycleGlobal}/]`, message: sinkMessage },
    {
      selector: `TemplateElement[value.cooked=/${boundary.lifecycleGlobal}/]`,
      message: sinkMessage,
    },
  ];
}

/**
 * @param {Boundary} boundary
 * @param {BoundaryFile} file
 */
function junctionOverride(boundary, file) {
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
            {
              regex: moduleSpecifierRegex(boundary.module),
              allowImportNames: allowedForFile,
              message: BOUNDARY_MESSAGE,
            },
            {
              regex: moduleSpecifierRegex(boundary.seamModule),
              allowImportNames: boundary.seamPublicNames,
              message:
                'Only the seam module’s declared public names may be imported from it.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        ...boundarySyntaxRules(boundary),
        {
          // Junction files have no dynamic imports at all (their inline
          // `import('x').T` annotations are type positions, not this node),
          // so any runtime dynamic import here is a boundary evasion.
          selector: 'ImportExpression',
          message: 'Junction files never use runtime dynamic imports.',
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
 *    module, and carries the same dynamic-import and lifecycle-global syntax
 *    rules as the junctions — a helper cannot launder a restricted name or
 *    reach the diagnostics sink dynamically on a junction file's behalf.
 * 2. One entry per junction file: the allowlist plus that file's dated
 *    allowances, the seam's public-name bound, the dynamic-import and
 *    lifecycle-global syntax rules, `noInlineConfig`, and its declared globals.
 *
 * @param {MaintainabilityRegistry} [registry]
 */
export function deriveBoundaryOverrides(registry = readRegistry()) {
  const { boundary } = registry;
  const closure = {
    files: ['src/**/*.{ts,tsx,mts,cts,svelte,js,mjs,cjs}'],
    ignores: [boundary.module, boundary.seamModule],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: moduleSpecifierRegex(boundary.module),
              allowImportNames: [...boundary.allowedImportNames],
              message: BOUNDARY_MESSAGE,
            },
            {
              regex: moduleSpecifierRegex(boundary.seamModule),
              allowImportNames: boundary.seamPublicNames,
              message:
                'Only the seam module’s declared public names may be imported from it.',
            },
          ],
        },
      ],
      'no-restricted-syntax': boundarySyntaxRules(boundary),
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
