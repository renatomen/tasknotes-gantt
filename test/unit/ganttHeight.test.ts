/**
 * Locks down the pure viewport height math (plan 003 U2). The functions take
 * SVAR's collapse-aware row count + row/scale heights and resolve the host
 * height that fits content up to the per-view max, then scrolls (R2/R3). No
 * DOM/SVAR dependency — the view wires these to the live store.
 */
import { describe, expect, it } from "@jest/globals";
import {
  computeContentHeight,
  resolveHostHeight,
  GANTT_MIN_HEIGHT,
  SCROLLBAR_ALLOWANCE,
  SVAR_CELL_HEIGHT,
  SVAR_SCALE_HEIGHT,
} from "../../src/bases/ganttHeight";

describe("constants", () => {
  it("derives the ~2-row floor from SVAR defaults (36 + 2×38 = 112)", () => {
    expect(GANTT_MIN_HEIGHT).toBe(SVAR_SCALE_HEIGHT + 2 * SVAR_CELL_HEIGHT);
    expect(GANTT_MIN_HEIGHT).toBe(112);
  });
});

describe("computeContentHeight", () => {
  it("is scaleHeight + rowCount×cellHeight + scrollbar allowance", () => {
    // 5 rows: 36 + 5×38 + 17 = 243
    expect(computeContentHeight(5, 38, 36)).toBe(36 + 5 * 38 + SCROLLBAR_ALLOWANCE);
    expect(computeContentHeight(5, 38, 36)).toBe(243);
  });

  it("counts zero rows as just the header + allowance", () => {
    expect(computeContentHeight(0, 38, 36)).toBe(36 + SCROLLBAR_ALLOWANCE);
  });

  it("floors a negative row count at zero", () => {
    expect(computeContentHeight(-3, 38, 36)).toBe(computeContentHeight(0, 38, 36));
  });

  it("honors a custom scrollbar allowance", () => {
    expect(computeContentHeight(2, 38, 36, 0)).toBe(36 + 2 * 38);
  });

  it("respects non-default row/scale heights (multi-row scale)", () => {
    // 3 rows at 50px under a 72px (two-row) scale: 72 + 3×50 + 17 = 239
    expect(computeContentHeight(3, 50, 72)).toBe(72 + 3 * 50 + SCROLLBAR_ALLOWANCE);
  });
});

describe("resolveHostHeight", () => {
  it("fits content when it is shorter than the max (R2 short case)", () => {
    // 3 rows → 36 + 3×38 + 17 = 167, under the 400 cap → fits exactly
    const h = resolveHostHeight(3, 38, 36, 400);
    expect(h).toBe(computeContentHeight(3, 38, 36));
    expect(h).toBeLessThan(400);
  });

  it("caps at maxHeight when content is taller (R2 tall case)", () => {
    // 30 rows → 36 + 30×38 + 17 = 1193, well over 400 → capped
    expect(resolveHostHeight(30, 38, 36, 400)).toBe(400);
  });

  it("never goes below the ~2-row floor (R3)", () => {
    // 0 rows → content 53, floored to 112
    expect(resolveHostHeight(0, 38, 36, 400)).toBe(GANTT_MIN_HEIGHT);
    expect(resolveHostHeight(1, 38, 36, 400)).toBe(GANTT_MIN_HEIGHT);
  });

  it("lets the floor win even when maxHeight is set below it", () => {
    // A mis-set tiny max must not produce an unusable sliver.
    expect(resolveHostHeight(10, 38, 36, 50)).toBe(GANTT_MIN_HEIGHT);
  });

  it("tracks a raised cap (R3 flow: maxHeight 400 → 800)", () => {
    // 15 rows → 36 + 15×38 + 17 = 623: capped at 400, but fits under 800
    expect(resolveHostHeight(15, 38, 36, 400)).toBe(400);
    expect(resolveHostHeight(15, 38, 36, 800)).toBe(computeContentHeight(15, 38, 36));
  });

  it("honors a configured minHeight above the absolute floor", () => {
    // 1 row content = 91, but the user set a 300px minimum → stays 300.
    expect(resolveHostHeight(1, 38, 36, 400, 300)).toBe(300);
  });

  it("clamps a configured minHeight up to the absolute ~2-row floor", () => {
    // A minHeight below GANTT_MIN_HEIGHT can't make the chart a sliver.
    expect(resolveHostHeight(1, 38, 36, 400, 50)).toBe(GANTT_MIN_HEIGHT);
  });

  it("lets content/maxHeight win when taller than the configured minHeight", () => {
    // 10 rows → content 433, capped at maxHeight 400 > min 300 → 400.
    expect(resolveHostHeight(10, 38, 36, 400, 300)).toBe(400);
  });

  it("lets the configured minHeight win even over a smaller maxHeight", () => {
    // min 500 > max 200 and > content → never shrink below the user's minimum.
    expect(resolveHostHeight(1, 38, 36, 200, 500)).toBe(500);
  });
});
