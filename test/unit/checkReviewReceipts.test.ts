import {
  evaluateReceipts,
  isDocsOnlyChange,
  parsePushedRefLines,
  partitionPushedShas,
  REQUIRED_LAYERS,
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
  it('pairs each pushed local sha with the remote sha its range is measured from', () => {
    const stdin =
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n` +
      `refs/heads/b ${OTHER_SHA} refs/heads/b ${DELETED}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({
      pushes: [
        { localSha: SHA, remoteSha: OTHER_SHA },
        { localSha: OTHER_SHA, remoteSha: DELETED },
      ],
      invalid: [],
    });
  });

  it('skips branch deletions (local sha all zeros)', () => {
    const stdin = `refs/heads/gone ${DELETED} refs/heads/gone ${SHA}\n`;

    expect(parsePushedRefLines(stdin)).toEqual({ pushes: [], invalid: [] });
  });

  it('deduplicates an identical ref record pushed twice', () => {
    const line = `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n`;

    expect(parsePushedRefLines(line + line)).toEqual({
      pushes: [{ localSha: SHA, remoteSha: OTHER_SHA }],
      invalid: [],
    });
  });

  it('keeps both records when one tip is pushed to two refs from different remote states', () => {
    const stdin =
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n` +
      `refs/tags/v1 ${SHA} refs/tags/v1 ${DELETED}\n`;

    expect(parsePushedRefLines(stdin).pushes).toEqual([
      { localSha: SHA, remoteSha: OTHER_SHA },
      { localSha: SHA, remoteSha: DELETED },
    ]);
  });

  it('yields nothing for empty or blank stdin (manual invocation falls back to HEAD)', () => {
    expect(parsePushedRefLines('')).toEqual({ pushes: [], invalid: [] });
    expect(parsePushedRefLines('\n  \n')).toEqual({ pushes: [], invalid: [] });
  });

  it('surfaces malformed lines instead of silently discarding them', () => {
    const stdin = `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\nnot a ref line\n`;

    const parsed = parsePushedRefLines(stdin);

    expect(parsed.pushes).toEqual([{ localSha: SHA, remoteSha: OTHER_SHA }]);
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

    expect(parsePushedRefLines(stdin)).toEqual({
      pushes: [{ localSha: sha256, remoteSha: 'd'.repeat(64) }],
      invalid: [],
    });
  });
});

describe('isDocsOnlyChange', () => {
  it('exempts a change confined to the docs tree', () => {
    expect(isDocsOnlyChange(['docs/backlog.md'])).toBe(true);
  });

  it('exempts a nested docs path', () => {
    expect(isDocsOnlyChange(['docs/solutions/logic-errors/a-learning.md'])).toBe(true);
  });

  it('exempts a multi-file change whose every path is under docs', () => {
    expect(isDocsOnlyChange(['docs/a.md', 'docs/plans/b.md', 'docs/media/c.png'])).toBe(true);
  });

  it('refuses a change that also touches source', () => {
    expect(isDocsOnlyChange(['docs/a.md', 'src/bases/register.ts'])).toBe(false);
  });

  it('matches on a path boundary, not a bare prefix', () => {
    expect(isDocsOnlyChange(['documentation/a.md'])).toBe(false);
    expect(isDocsOnlyChange(['docsy/a.md'])).toBe(false);
  });

  it('refuses a root file whose whole name is docs', () => {
    expect(isDocsOnlyChange(['docs'])).toBe(false);
  });

  it('refuses an empty change list — an unknown range is never exempt', () => {
    expect(isDocsOnlyChange([])).toBe(false);
  });

  it('refuses a range that could not be resolved to a path list', () => {
    expect(isDocsOnlyChange(null)).toBe(false);
  });
});

describe('partitionPushedShas', () => {
  const record = (localSha: string, remoteSha = OTHER_SHA) => ({ localSha, remoteSha });

  it('exempts a sha whose only pushed range is docs-only', () => {
    const verdict = partitionPushedShas([record(SHA)], () => true);

    expect(verdict).toEqual({ exempt: [SHA], gated: [] });
  });

  it('gates a sha whose pushed range touches code', () => {
    const verdict = partitionPushedShas([record(SHA)], () => false);

    expect(verdict).toEqual({ exempt: [], gated: [SHA] });
  });

  it('gates only the code-bearing ref when one push carries both kinds', () => {
    const docsRef = record(SHA);
    const codeRef = record(OTHER_SHA);

    const verdict = partitionPushedShas([docsRef, codeRef], (r) => r.localSha === SHA);

    expect(verdict).toEqual({ exempt: [SHA], gated: [OTHER_SHA] });
  });

  it('gates a tip whose ranges disagree: one docs-only ref does not exempt its code-bearing twin', () => {
    const records = [record(SHA, OTHER_SHA), record(SHA, DELETED)];

    const verdict = partitionPushedShas(records, (r) => r.remoteSha === OTHER_SHA);

    expect(verdict).toEqual({ exempt: [], gated: [SHA] });
  });

  it('yields nothing to gate for an empty push', () => {
    expect(partitionPushedShas([], () => true)).toEqual({ exempt: [], gated: [] });
  });
});
