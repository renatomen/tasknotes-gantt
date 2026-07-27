import { evaluateReceipts, REQUIRED_LAYERS } from '../../scripts/check-review-receipts.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const cleanLayers = () =>
  Object.fromEntries(REQUIRED_LAYERS.map((layer) => [layer, '2026-07-28T00:00:00.000Z']));

describe('evaluateReceipts', () => {
  it('passes when both layers hold clean receipts for HEAD', () => {
    const verdict = evaluateReceipts({ sha: SHA, layers: cleanLayers() }, SHA);

    expect(verdict.ok).toBe(true);
    expect(verdict.missing).toEqual([]);
  });

  it('fails with every layer missing when no receipts exist', () => {
    const verdict = evaluateReceipts({ sha: null, layers: {} }, SHA);

    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual([...REQUIRED_LAYERS]);
  });

  it('invalidates receipts recorded against a different commit', () => {
    const verdict = evaluateReceipts({ sha: OTHER_SHA, layers: cleanLayers() }, SHA);

    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual([...REQUIRED_LAYERS]);
    expect(verdict.staleSha).toBe(OTHER_SHA);
  });

  it('fails when only one layer has recorded a receipt', () => {
    const layers = { [REQUIRED_LAYERS[0]]: '2026-07-28T00:00:00.000Z' };

    const verdict = evaluateReceipts({ sha: SHA, layers }, SHA);

    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(REQUIRED_LAYERS.slice(1));
  });
});
