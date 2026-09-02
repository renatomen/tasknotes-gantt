import {
  ARCHIVAL_SUBJECT_REF_PREFIX,
  evaluateReceipts,
  parsePushedRefLines,
  REQUIRED_LAYERS,
  validateArchivalSubjects,
} from '../../scripts/check-review-receipts.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const DELETED = '0'.repeat(40);
const cleanLayers = () =>
  Object.fromEntries(REQUIRED_LAYERS.map((layer) => [layer, '2026-07-28T00:00:00.000Z']));

describe('evaluateReceipts', () => {
  it('passes when both layers hold clean receipts for the pushed sha', () => {
    const verdict = evaluateReceipts({ receipts: { [SHA]: cleanLayers() } }, [SHA]);

    expect(verdict.ok).toBe(true);
    expect(verdict.missingBySha).toEqual({});
  });

  it('does not accept the retired model-specific receipt as the cross-model peer', () => {
    const retiredLayers = {
      'ce-code-review': '2026-07-28T00:00:00.000Z',
      'codex-local': '2026-07-28T00:00:00.000Z',
    };

    const verdict = evaluateReceipts({ receipts: { [SHA]: retiredLayers } }, [SHA]);

    expect(verdict.ok).toBe(false);
    expect(verdict.missingBySha).toEqual({ [SHA]: ['cross-model-peer'] });
  });

  it('fails with every layer missing when no receipts exist', () => {
    const verdict = evaluateReceipts({ receipts: {} }, [SHA]);

    expect(verdict.ok).toBe(false);
    expect(verdict.missingBySha).toEqual({ [SHA]: [...REQUIRED_LAYERS] });
  });

  it('treats receipts recorded against a different commit as missing', () => {
    const verdict = evaluateReceipts({ receipts: { [OTHER_SHA]: cleanLayers() } }, [SHA]);

    expect(verdict.ok).toBe(false);
    expect(verdict.missingBySha).toEqual({ [SHA]: [...REQUIRED_LAYERS] });
  });

  it('fails when only one layer has recorded a receipt', () => {
    const layers = { [REQUIRED_LAYERS[0]!]: '2026-07-28T00:00:00.000Z' };

    const verdict = evaluateReceipts({ receipts: { [SHA]: layers } }, [SHA]);

    expect(verdict.ok).toBe(false);
    expect(verdict.missingBySha).toEqual({ [SHA]: REQUIRED_LAYERS.slice(1) });
  });

  it('demands receipts for EVERY pushed sha: one clean and one unreviewed fails on the unreviewed one only', () => {
    const store = { receipts: { [SHA]: cleanLayers() } };

    const verdict = evaluateReceipts(store, [SHA, OTHER_SHA]);

    expect(verdict.ok).toBe(false);
    expect(verdict.missingBySha).toEqual({ [OTHER_SHA]: [...REQUIRED_LAYERS] });
  });

  it('passes a multi-sha push when every pushed sha holds both receipts', () => {
    const store = { receipts: { [SHA]: cleanLayers(), [OTHER_SHA]: cleanLayers() } };

    const verdict = evaluateReceipts(store, [SHA, OTHER_SHA]);

    expect(verdict.ok).toBe(true);
  });

  it('tolerates the legacy single-sha store shape by treating it as empty', () => {
    const verdict = evaluateReceipts({ sha: SHA, layers: cleanLayers() } as never, [SHA]);

    expect(verdict.ok).toBe(false);
    expect(verdict.missingBySha).toEqual({ [SHA]: [...REQUIRED_LAYERS] });
  });
});

describe('parsePushedRefLines', () => {
  it('extracts the local sha of each pushed ref line', () => {
    const stdin =
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n` +
      `refs/heads/b ${OTHER_SHA} refs/heads/b ${DELETED}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({ shas: [SHA, OTHER_SHA], invalid: [], archival: [] });
  });

  it('skips branch deletions (local sha all zeros)', () => {
    const stdin = `refs/heads/gone ${DELETED} refs/heads/gone ${SHA}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({ shas: [], invalid: [], archival: [] });
  });

  it('deduplicates the same sha pushed under two refs', () => {
    const stdin =
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n` +
      `refs/tags/v1 ${SHA} refs/tags/v1 ${DELETED}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({ shas: [SHA], invalid: [], archival: [] });
  });

  it('does not gate a push into the archival subject namespace, but reports it for validation', () => {
    const stdin = `refs/e11-subjects/e0cae52 ${SHA} refs/e11-subjects/e0cae52 ${DELETED}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      shas: [],
      invalid: [],
      archival: [{ ref: 'refs/e11-subjects/e0cae52', sha: SHA }],
    });
  });

  it('reports a deletion of an archival ref, so the check can refuse it', () => {
    const stdin = `refs/e11-subjects/e0cae52 ${DELETED} refs/e11-subjects/e0cae52 ${SHA}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      shas: [],
      invalid: [],
      archival: [{ ref: 'refs/e11-subjects/e0cae52', sha: DELETED }],
    });
  });

  it('still gates the same sha when it is also pushed to a branch alongside an archival ref', () => {
    const stdin =
      `refs/e11-subjects/e0cae52 ${SHA} refs/e11-subjects/e0cae52 ${DELETED}\n` +
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      shas: [SHA],
      invalid: [],
      archival: [{ ref: 'refs/e11-subjects/e0cae52', sha: SHA }],
    });
  });

  it('still refuses a malformed line even when it names the archival namespace', () => {
    const stdin = `refs/e11-subjects/x ${SHA} refs/e11-subjects/x\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      shas: [],
      invalid: [`refs/e11-subjects/x ${SHA} refs/e11-subjects/x`],
      archival: [],
    });
  });

  it('yields nothing for empty or blank stdin (manual invocation falls back to HEAD)', () => {
    expect(parsePushedRefLines('')).toEqual({ shas: [], invalid: [], archival: [] });
    expect(parsePushedRefLines('\n  \n')).toEqual({ shas: [], invalid: [], archival: [] });
  });

  it('surfaces malformed lines instead of silently discarding them', () => {
    const stdin = `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\nnot a ref line\n`;

    const parsed = parsePushedRefLines(stdin);

    expect(parsed.shas).toEqual([SHA]);
    expect(parsed.invalid).toEqual(['not a ref line']);
  });

  it('surfaces a line whose sha token is not valid hex of sha1/sha256 width', () => {
    const bad = `refs/heads/a ${'g'.repeat(40)} refs/heads/a ${OTHER_SHA}\n`;

    expect(parsePushedRefLines(bad).invalid).toHaveLength(1);
  });

  it('accepts sha256-width (64 hex) object names, including their deletion form', () => {
    const sha256 = 'c'.repeat(64);
    const stdin =
      `refs/heads/a ${sha256} refs/heads/a ${'d'.repeat(64)}\n` +
      `refs/heads/gone ${'0'.repeat(64)} refs/heads/gone ${sha256}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({ shas: [sha256], invalid: [], archival: [] });
  });
});

describe('validateArchivalSubjects', () => {
  const COMMIT = 'e0cae5257' + 'f'.repeat(31);
  const subjectRef = (suffix: string) => `${ARCHIVAL_SUBJECT_REF_PREFIX}${suffix}`;
  // Resolves like `git rev-parse --verify <name>^{commit}`: full shas and their
  // unique abbreviations resolve, anything else (blob, ambiguous, unknown) throws.
  const peel = (name: string): string => {
    const resolved = [COMMIT, OTHER_SHA].filter((commit) => commit.startsWith(name));
    if (resolved.length !== 1) throw new Error(`fatal: ${name} does not resolve to one commit`);
    return resolved[0]!;
  };

  it('accepts an archival ref whose suffix resolves to the commit that was pushed', () => {
    expect(validateArchivalSubjects([{ ref: subjectRef('e0cae52'), sha: COMMIT }], peel)).toEqual([]);
  });

  it('refuses an archival ref whose suffix names a different commit than the one pushed', () => {
    const problems = validateArchivalSubjects([{ ref: subjectRef('e0cae52'), sha: OTHER_SHA }], peel);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('e0cae52');
    expect(problems[0]).toContain(OTHER_SHA.slice(0, 7));
  });

  it('refuses a suffix that does not resolve to exactly one commit, even when it prefixes the pushed one', () => {
    // Two local commits sharing the prefix: startsWith would pass both, so the
    // pushed subject could be silently swapped for its prefix-twin.
    const ambiguous = 'e0cae5257' + 'f'.repeat(30) + '0';
    const peelAmbiguous = (name: string): string => {
      if (name === COMMIT) return COMMIT;
      if (name === ambiguous) return ambiguous;
      throw new Error('fatal: short object ID is ambiguous');
    };

    const problems = validateArchivalSubjects([{ ref: subjectRef('e0cae52'), sha: COMMIT }], peelAmbiguous);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not resolve');
  });

  it('refuses an archival object that does not peel to a commit', () => {
    const problems = validateArchivalSubjects([{ ref: subjectRef('e0cae52'), sha: SHA }], peel);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a commit');
  });

  it('refuses a suffix too short to name a commit', () => {
    expect(validateArchivalSubjects([{ ref: subjectRef('e0c'), sha: COMMIT }], peel)).toHaveLength(1);
  });

  it('refuses a deletion of an archival ref', () => {
    const problems = validateArchivalSubjects([{ ref: subjectRef('e0cae52'), sha: DELETED }], peel);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('delet');
  });
});
