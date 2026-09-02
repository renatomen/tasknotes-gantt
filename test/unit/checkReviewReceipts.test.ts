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
      archival: [{ ref: 'refs/e11-subjects/e0cae52', sha: SHA, remoteSha: DELETED }],
    });
  });

  it('reports a deletion of an archival ref, so the check can refuse it', () => {
    const stdin = `refs/e11-subjects/e0cae52 ${DELETED} refs/e11-subjects/e0cae52 ${SHA}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      shas: [],
      invalid: [],
      archival: [{ ref: 'refs/e11-subjects/e0cae52', sha: DELETED, remoteSha: SHA }],
    });
  });

  it('still gates the same sha when it is also pushed to a branch alongside an archival ref', () => {
    const stdin =
      `refs/e11-subjects/e0cae52 ${SHA} refs/e11-subjects/e0cae52 ${DELETED}\n` +
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      shas: [SHA],
      invalid: [],
      archival: [{ ref: 'refs/e11-subjects/e0cae52', sha: SHA, remoteSha: DELETED }],
    });
  });

  it('keeps a non-ASCII whitespace byte inside the ref token instead of treating it as a separator', () => {
    // git accepts U+00A0 inside a refname; JS \s would have split on it and
    // handed the validator a name shorter than the ref git will create.
    const stdin = `refs/e11-subjects/e0cae52\u00a0 ${SHA} refs/e11-subjects/e0cae52\u00a0 ${DELETED}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      shas: [],
      invalid: [],
      archival: [{ ref: 'refs/e11-subjects/e0cae52\u00a0', sha: SHA, remoteSha: DELETED }],
    });
  });

  it('refuses a line whose fields are separated by anything but one ASCII space', () => {
    const stdin = `refs/heads/a  ${SHA} refs/heads/a ${OTHER_SHA}\n`;

    expect(parsePushedRefLines(stdin).invalid).toHaveLength(1);
  });

  it('tolerates a trailing carriage return on a ref line', () => {
    const stdin = `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\r\n`;

    expect(parsePushedRefLines(stdin)).toEqual({ shas: [SHA], invalid: [], archival: [] });
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
  const BLOB = 'e0cae52ab' + 'e'.repeat(31);
  const TAG = 'd'.repeat(40);
  const subjectRef = (name: string) => `${ARCHIVAL_SUBJECT_REF_PREFIX}${name}`;
  const creation = (name: string, sha: string) => ({ ref: subjectRef(name), sha, remoteSha: DELETED });
  // Answers like `git cat-file -t`; unknown objects throw.
  const typeOf = (objects: Record<string, string>) => (sha: string): string => {
    const type = objects[sha];
    if (type === undefined) throw new Error(`fatal: unknown object ${sha}`);
    return type;
  };
  const twoCommits = typeOf({ [COMMIT]: 'commit', [OTHER_SHA]: 'commit' });

  it('accepts a pin named by the full object id of the pushed commit', () => {
    expect(validateArchivalSubjects([creation(COMMIT, COMMIT)], twoCommits)).toEqual([]);
  });

  it('refuses a pin named by an abbreviation, however unambiguous today: a later object can share it', () => {
    const problems = validateArchivalSubjects([creation('e0cae52', COMMIT)], twoCommits);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('full object id');
  });

  it('refuses a pin named by a different commit than the one pushed', () => {
    const problems = validateArchivalSubjects([creation(COMMIT, OTHER_SHA)], twoCommits);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(COMMIT.slice(0, 7));
    expect(problems[0]).toContain(OTHER_SHA.slice(0, 7));
  });

  it('refuses an annotated tag object, even one that points at the subject commit', () => {
    // The remote ref would hold the tag, so the pin would resolve to an object
    // other than the commit it names.
    const problems = validateArchivalSubjects([creation(COMMIT, TAG)], typeOf({ [COMMIT]: 'commit', [TAG]: 'tag' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('tag');
    expect(problems[0]).toContain('not a commit');
  });

  it('refuses a blob object', () => {
    const problems = validateArchivalSubjects([creation(BLOB, BLOB)], typeOf({ [COMMIT]: 'commit', [BLOB]: 'blob' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a commit');
  });

  it('refuses an object this repository does not hold', () => {
    const problems = validateArchivalSubjects([creation(COMMIT, COMMIT)], typeOf({}));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('cannot be read as an object');
  });

  it('refuses a deletion of an archival ref', () => {
    const deletion = { ref: subjectRef(COMMIT), sha: DELETED, remoteSha: COMMIT };

    const problems = validateArchivalSubjects([deletion], twoCommits);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('delet');
  });

  it('refuses replacing an existing archival ref, even with an honestly named commit', () => {
    const replacement = { ref: subjectRef(COMMIT), sha: COMMIT, remoteSha: OTHER_SHA };

    const problems = validateArchivalSubjects([replacement], twoCommits);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('write-once');
  });
});
