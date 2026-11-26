import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateProductionAudit,
  parseAuditReport,
  readAuditResult,
  type AuditException,
} from '../../scripts/check-production-audit.mjs';

const ZOD_ADVISORY = {
  source: 1243066,
  name: 'zod',
  dependency: 'zod',
  title: 'Zod can exhaust memory while validating oversized constrained collections',
  url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
  severity: 'high',
  range: '<4.6.6',
};

const LODASH_ADVISORY = {
  name: 'lodash',
  title: 'Prototype pollution',
  url: 'https://github.com/advisories/GHSA-r5fr-rjxr-66jc',
  severity: 'high',
};

function report(vulnerabilities: Record<string, unknown>) {
  return { auditReportVersion: 2, vulnerabilities };
}

const zodReport = report({
  zod: { name: 'zod', severity: 'high', via: [ZOD_ADVISORY], effects: ['@tasknotes/model'] },
  '@tasknotes/model': { name: '@tasknotes/model', severity: 'high', via: ['zod'], effects: [] },
});

function exception(pkg: string, advisory: string): AuditException {
  return {
    advisory,
    package: pkg,
    recorded: '2026-11-26',
    reason: 'not reachable from the plugin',
    removeWhen: 'the advisory is fixed upstream',
  };
}

const zodException = exception('zod', 'GHSA-mrhx-c7xc-m3w5');

describe('evaluateProductionAudit', () => {
  it('passes a high advisory that has an exception for its package', () => {
    const result = evaluateProductionAudit(zodReport, [zodException]);

    expect(result).toEqual({ blocking: [], stale: [] });
  });

  it('blocks a high advisory that has no exception, naming its id and package', () => {
    const result = evaluateProductionAudit(zodReport, []);

    expect(result.blocking).toEqual([
      { advisory: 'GHSA-mrhx-c7xc-m3w5', package: 'zod', severity: 'high', title: ZOD_ADVISORY.title },
    ]);
  });

  it('blocks a critical advisory that has no exception', () => {
    const critical = report({
      lodash: { severity: 'critical', via: [{ ...LODASH_ADVISORY, severity: 'critical' }] },
    });

    const result = evaluateProductionAudit(critical, []);

    expect(result.blocking.map((finding) => finding.advisory)).toEqual(['GHSA-r5fr-rjxr-66jc']);
  });

  it('lets a moderate advisory through, matching the high audit level', () => {
    const moderate = report({
      zod: { severity: 'moderate', via: [{ ...ZOD_ADVISORY, severity: 'moderate' }] },
    });

    const result = evaluateProductionAudit(moderate, []);

    expect(result.blocking).toEqual([]);
  });

  it('does not let an exception for one package excuse another package with the same advisory', () => {
    const shared = report({
      lodash: { severity: 'high', via: [LODASH_ADVISORY] },
      'lodash-es': { severity: 'high', via: [{ ...LODASH_ADVISORY, name: 'lodash-es' }] },
    });

    const result = evaluateProductionAudit(shared, [exception('lodash', 'GHSA-r5fr-rjxr-66jc')]);

    expect(result.blocking.map((finding) => finding.package)).toEqual(['lodash-es']);
  });

  it('reports a package once when npm lists its advisory twice', () => {
    const repeated = report({
      zod: { severity: 'high', via: [ZOD_ADVISORY, ZOD_ADVISORY] },
    });

    const result = evaluateProductionAudit(repeated, []);

    expect(result.blocking).toHaveLength(1);
  });

  it('flags an exception whose advisory is no longer reported, so the entry gets removed', () => {
    const result = evaluateProductionAudit(report({}), [zodException]);

    expect(result.stale).toEqual([zodException]);
  });

  it('flags an exception as stale once its package no longer carries the advisory, even if another package does', () => {
    const elsewhere = report({
      'lodash-es': { severity: 'high', via: [{ ...LODASH_ADVISORY, name: 'lodash-es' }] },
    });
    const lodashException = exception('lodash', 'GHSA-r5fr-rjxr-66jc');

    const result = evaluateProductionAudit(elsewhere, [lodashException]);

    expect(result.stale).toEqual([lodashException]);
  });
});

describe('parseAuditReport', () => {
  it('refuses an npm error response instead of reading it as zero advisories', () => {
    expect(() => parseAuditReport('{"error":{"code":"E503","summary":"Service Unavailable"}}')).toThrow(/E503/);
  });

  it('refuses output that carries no vulnerabilities object', () => {
    expect(() => parseAuditReport('{"auditReportVersion":2}')).toThrow(/vulnerabilities/);
  });

  it('refuses output that is not JSON', () => {
    expect(() => parseAuditReport('npm ERR! network')).toThrow(/not JSON/);
  });

  it('refuses a report in a format version this check does not know', () => {
    expect(() => parseAuditReport(JSON.stringify({ ...zodReport, auditReportVersion: 3 }))).toThrow(/version/);
  });

  it('refuses a report whose vulnerabilities are not keyed by package', () => {
    expect(() => parseAuditReport(JSON.stringify({ auditReportVersion: 2, vulnerabilities: [] }))).toThrow(
      /vulnerabilities/,
    );
  });

  it('returns a report that lists vulnerabilities', () => {
    const text = JSON.stringify(zodReport);

    expect(parseAuditReport(text)).toEqual(zodReport);
  });
});

describe('readAuditResult', () => {
  it('refuses the output of an npm process that was killed, however complete it looks', () => {
    const killed = { error: undefined, signal: 'SIGTERM', status: null, stdout: JSON.stringify(zodReport) };

    expect(() => readAuditResult(killed)).toThrow(/SIGTERM/);
  });

  it('reads the report of an npm run that exited 1 because it found advisories', () => {
    const found = { error: undefined, signal: null, status: 1, stdout: JSON.stringify(zodReport) };

    expect(readAuditResult(found)).toEqual(zodReport);
  });
});

describe('committed production-audit exceptions', () => {
  const exceptions: AuditException[] = JSON.parse(
    readFileSync(resolve('scripts/production-audit-exceptions.json'), 'utf8'),
  );

  it('gives every entry an advisory id, package, date, reason and removal condition', () => {
    for (const entry of exceptions) {
      expect(entry.advisory).toMatch(/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/);
      expect(entry.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const field of [entry.package, entry.reason, entry.removeWhen]) {
        expect(typeof field).toBe('string');
        expect(field.trim()).not.toBe('');
      }
    }
  });
});
