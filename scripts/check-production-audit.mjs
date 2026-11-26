/**
 * The production-dependency audit gate. It fails on every high or critical advisory
 * that `npm audit --omit=dev` reports, except one named in
 * `production-audit-exceptions.json`. An exception holds only while its package's
 * code stays out of the built bundle, and it must be deleted once npm stops
 * reporting its advisory, so an exception can neither outlive its reason nor
 * linger after the fix.
 *
 *   node scripts/check-production-audit.mjs [bundle]   bundle defaults to dist/main.js
 *
 * Exit 0: no unexcepted advisory. 1: findings. 2: the check could not run.
 *
 * @module scripts/check-production-audit
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS_PATH = join(repoRoot, 'scripts/production-audit-exceptions.json');
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/**
 * @typedef {object} AuditException
 * @property {string} advisory - GitHub advisory id, e.g. GHSA-xxxx-xxxx-xxxx
 * @property {string} package - the npm package the advisory names
 * @property {string} recorded - the date the exception was agreed, YYYY-MM-DD
 * @property {string} bundleMarker - text that appears in the bundle only when the package's code is bundled
 * @property {string} reason - why the advisory cannot reach users
 * @property {string} removeWhen - the condition under which the entry goes
 */

/**
 * @typedef {object} AuditFinding
 * @property {string} advisory
 * @property {string} package
 * @property {string} severity
 * @property {string} title
 */

/**
 * @typedef {object} AuditResult
 * @property {AuditFinding[]} blocking - reported high or critical advisories without an exception
 * @property {string[]} stale - excepted advisories npm no longer reports
 * @property {{ advisory: string, package: string, marker: string }[]} bundled - excepted advisories whose package code is in the bundle
 */

function advisoryId(url) {
  const match = /GHSA(?:-[a-z0-9]{4}){3}/i.exec(String(url ?? ''));
  return match ? match[0] : String(url ?? '');
}

function reportedAdvisories(report) {
  /** @type {Map<string, AuditFinding>} */
  const advisories = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const id = advisoryId(via.url);
      if (!advisories.has(id)) {
        advisories.set(id, { advisory: id, package: via.name, severity: via.severity, title: via.title });
      }
    }
  }
  return advisories;
}

/**
 * Judge an `npm audit --json` report against the committed exceptions.
 *
 * @param {object} report - parsed `npm audit --omit=dev --json` output
 * @param {AuditException[]} exceptions
 * @param {string} bundleText - the built bundle's contents
 * @returns {AuditResult}
 */
export function evaluateProductionAudit(report, exceptions, bundleText) {
  const advisories = reportedAdvisories(report);
  const excepted = new Set(exceptions.map((entry) => entry.advisory));
  const blocking = [...advisories.values()].filter(
    (finding) => BLOCKING_SEVERITIES.has(finding.severity) && !excepted.has(finding.advisory),
  );
  const stale = exceptions.filter((entry) => !advisories.has(entry.advisory)).map((entry) => entry.advisory);
  const bundled = exceptions
    .filter((entry) => advisories.has(entry.advisory) && bundleText.includes(entry.bundleMarker))
    .map((entry) => ({ advisory: entry.advisory, package: entry.package, marker: entry.bundleMarker }));
  return { blocking, stale, bundled };
}

/**
 * Parse `npm audit --json` output, refusing anything that is not an audit report.
 * npm exits non-zero both when it finds advisories and when the audit itself
 * fails, so the exit status cannot tell the two apart; the report's shape can.
 *
 * @param {string} text - raw stdout of `npm audit --omit=dev --json`
 * @returns {object} the parsed report
 */
export function parseAuditReport(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error(`npm audit output is not JSON: ${String(text).slice(0, 200)}`);
  }
  if (report?.error) {
    throw new Error(`npm audit failed: ${report.error.code ?? ''} ${report.error.summary ?? ''}`.trim());
  }
  if (typeof report?.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error('npm audit output has no vulnerabilities object');
  }
  return report;
}

function runProductionAudit() {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return parseAuditReport(result.stdout);
}

function main(args) {
  const bundlePath = resolve(repoRoot, args[0] ?? 'dist/main.js');
  const exceptions = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'));
  const { blocking, stale, bundled } = evaluateProductionAudit(
    runProductionAudit(),
    exceptions,
    readFileSync(bundlePath, 'utf8'),
  );
  for (const finding of blocking) {
    console.error(`${finding.severity}: ${finding.advisory} in ${finding.package} — ${finding.title}`);
  }
  for (const advisory of stale) {
    console.error(`stale exception: ${advisory} is no longer reported; delete it from production-audit-exceptions.json`);
  }
  for (const entry of bundled) {
    console.error(`exception void: ${entry.advisory} assumes ${entry.package} is not bundled, but "${entry.marker}" is in the bundle`);
  }
  const failed = blocking.length + stale.length + bundled.length > 0;
  if (!failed) console.log(`production audit clean (${exceptions.length} documented exception(s) in force)`);
  return failed ? 1 : 0;
}

const isDirectRun =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`Production audit check could not run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
