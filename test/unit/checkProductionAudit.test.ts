import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateProductionAudit,
  executableBundleText,
  parseAuditReport,
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

function report(vulnerabilities: Record<string, unknown>) {
  return { auditReportVersion: 2, vulnerabilities };
}

const zodReport = report({
  zod: { name: 'zod', severity: 'high', via: [ZOD_ADVISORY], effects: ['@tasknotes/model'] },
  '@tasknotes/model': { name: '@tasknotes/model', severity: 'high', via: ['zod'], effects: [] },
});

const zodException: AuditException = {
  advisory: 'GHSA-mrhx-c7xc-m3w5',
  package: 'zod',
  recorded: '2026-11-26',
  bundleMarker: 'ZodError',
  reason: 'zod is not bundled into main.js',
  removeWhen: '@tasknotes/model depends on a zod release outside the advisory range',
};

describe('evaluateProductionAudit', () => {
  it('passes a high advisory that is excepted and whose package is absent from the bundle', () => {
    const result = evaluateProductionAudit(zodReport, [zodException], 'bundle without it');

    expect(result).toEqual({ blocking: [], stale: [], bundled: [] });
  });

  it('blocks a high advisory that has no exception, naming its id and package', () => {
    const result = evaluateProductionAudit(zodReport, [], 'bundle');

    expect(result.blocking).toEqual([
      { advisory: 'GHSA-mrhx-c7xc-m3w5', package: 'zod', severity: 'high', title: ZOD_ADVISORY.title },
    ]);
  });

  it('blocks a critical advisory that has no exception', () => {
    const critical = report({
      lodash: {
        severity: 'critical',
        via: [{ ...ZOD_ADVISORY, name: 'lodash', severity: 'critical', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }],
      },
    });

    const result = evaluateProductionAudit(critical, [], 'bundle');

    expect(result.blocking.map((finding) => finding.advisory)).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });

  it('lets a moderate advisory through, matching the high audit level', () => {
    const moderate = report({
      zod: { severity: 'moderate', via: [{ ...ZOD_ADVISORY, severity: 'moderate' }] },
    });

    const result = evaluateProductionAudit(moderate, [], 'bundle');

    expect(result.blocking).toEqual([]);
  });

  it('reports one advisory once when two packages carry it', () => {
    const twice = report({
      zod: { severity: 'high', via: [ZOD_ADVISORY] },
      'zod-fork': { severity: 'high', via: [ZOD_ADVISORY] },
    });

    const result = evaluateProductionAudit(twice, [], 'bundle');

    expect(result.blocking).toHaveLength(1);
  });

  it('flags an exception whose advisory is no longer reported, so the entry gets removed', () => {
    const clean = report({});

    const result = evaluateProductionAudit(clean, [zodException], 'bundle');

    expect(result.stale).toEqual(['GHSA-mrhx-c7xc-m3w5']);
  });

  it('flags an excepted advisory once its package code appears in the bundle', () => {
    const result = evaluateProductionAudit(zodReport, [zodException], 'class ZodError extends Error {}');

    expect(result.bundled).toEqual([{ advisory: 'GHSA-mrhx-c7xc-m3w5', package: 'zod', marker: 'ZodError' }]);
  });
});

describe('executableBundleText', () => {
  const note = { content: 'Fixed a crash that surfaced as ZodError in the console.' };

  it('keeps an exception in force when only inlined release-note prose names its marker', () => {
    const bundle = `const notes = [{ content: ${JSON.stringify(note.content)} }];`;

    const result = evaluateProductionAudit(zodReport, [zodException], executableBundleText(bundle, [note]));

    expect(result.bundled).toEqual([]);
  });

  it('still voids an exception when the marker appears in code outside the notes', () => {
    const bundle = `const notes = [{ content: ${JSON.stringify(note.content)} }]; class ZodError extends Error {}`;

    const result = evaluateProductionAudit(zodReport, [zodException], executableBundleText(bundle, [note]));

    expect(result.bundled.map((entry) => entry.advisory)).toEqual(['GHSA-mrhx-c7xc-m3w5']);
  });
});

describe('parseAuditReport', () => {
  it('refuses an npm error response instead of reading it as zero advisories', () => {
    expect(() => parseAuditReport('{"error":{"code":"E503","summary":"Service Unavailable"}}')).toThrow(/E503/);
  });

  it('refuses output that carries no vulnerabilities object', () => {
    expect(() => parseAuditReport('{}')).toThrow(/vulnerabilities/);
  });

  it('refuses output that is not JSON', () => {
    expect(() => parseAuditReport('npm ERR! network')).toThrow(/not JSON/);
  });

  it('returns a report that lists vulnerabilities', () => {
    const text = JSON.stringify(zodReport);

    expect(parseAuditReport(text)).toEqual(zodReport);
  });
});

describe('committed production-audit exceptions', () => {
  const exceptions: AuditException[] = JSON.parse(
    readFileSync(resolve('scripts/production-audit-exceptions.json'), 'utf8'),
  );

  it('gives every entry an advisory id, package, date, bundle marker, reason and removal condition', () => {
    for (const entry of exceptions) {
      expect(entry.advisory).toMatch(/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/);
      expect(entry.package).not.toBe('');
      expect(entry.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.bundleMarker).not.toBe('');
      expect(entry.reason).not.toBe('');
      expect(entry.removeWhen).not.toBe('');
    }
  });
});
