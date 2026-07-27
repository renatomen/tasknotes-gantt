import {
  evaluateReceipts,
  parsePushedLocalShas,
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

describe('parsePushedLocalShas', () => {
  it('extracts the local sha of each pushed ref line', () => {
    const stdin =
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n` +
      `refs/heads/b ${OTHER_SHA} refs/heads/b ${DELETED}\n`;

    expect(parsePushedLocalShas(stdin)).toEqual([SHA, OTHER_SHA]);
  });

  it('skips branch deletions (local sha all zeros)', () => {
    const stdin = `refs/heads/gone ${DELETED} refs/heads/gone ${SHA}\n`;

    expect(parsePushedLocalShas(stdin)).toEqual([]);
  });

  it('deduplicates the same sha pushed under two refs', () => {
    const stdin =
      `refs/heads/a ${SHA} refs/heads/a ${OTHER_SHA}\n` +
      `refs/tags/v1 ${SHA} refs/tags/v1 ${DELETED}\n`;

    expect(parsePushedLocalShas(stdin)).toEqual([SHA]);
  });

  it('yields nothing for empty or blank stdin (manual invocation falls back to HEAD)', () => {
    expect(parsePushedLocalShas('')).toEqual([]);
    expect(parsePushedLocalShas('\n  \n')).toEqual([]);
  });
});
