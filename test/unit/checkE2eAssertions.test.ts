import {
  assertionLessCases,
  findTestCases,
  isScannedSpec,
} from '../../scripts/check-e2e-assertions.mjs';

const wrap = (body: string): string => `describe("s", () => {\n${body}\n});\n`;

describe('findTestCases', () => {
  it('finds a case at the top indent level', () => {
    const source = wrap('  it("alpha", async () => {\n    await go();\n  });');

    expect(findTestCases(source).map((c) => c.name)).toEqual(['alpha']);
  });

  it('finds a case nested inside another describe, whatever its indent', () => {
    const source = wrap(
      '  describe("inner", () => {\n    it("beta", async () => {\n      await go();\n    });\n  });',
    );

    expect(findTestCases(source).map((c) => c.name)).toEqual(['beta']);
  });

  it('finds it.only and it.skip as cases', () => {
    const source = wrap(
      '  it.only("gamma", () => { expect(1).toBe(1); });\n  it.skip("delta", () => {});',
    );

    expect(findTestCases(source).map((c) => c.name)).toEqual(['gamma', 'delta']);
  });

  it('does not mistake a word ending in it for a case', () => {
    const source = wrap('  await submit("nope", () => {});\n  visit("also nope", () => {});');

    expect(findTestCases(source)).toEqual([]);
  });

  it('spans a body containing parentheses inside strings and template literals', () => {
    const source = wrap(
      '  it("epsilon", async () => {\n' +
        '    const s = "a ) ( b";\n' +
        '    const t = `x ${fn(")")} y`;\n' +
        '    expect(s).toBe(t);\n' +
        '  });',
    );

    const cases = findTestCases(source);

    expect(cases.map((c) => c.name)).toEqual(['epsilon']);
    expect(cases[0]!.body).toContain('expect(s)');
  });

  it('reports the line each case starts on', () => {
    const source = wrap('  it("zeta", () => {\n    expect(1).toBe(1);\n  });');

    expect(findTestCases(source)[0]!.line).toBe(2);
  });
});

describe('assertionLessCases', () => {
  it('flags a case whose only gate is a waitUntil', () => {
    const source = wrap(
      '  it("polls but never asserts", async () => {\n' +
        '    await browser.waitUntil(async () => (await read()) === 1, { timeout: 5 });\n' +
        '  });',
    );

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['polls but never asserts']);
  });

  it('passes a case that asserts on the value it polled', () => {
    const source = wrap(
      '  it("polls then asserts", async () => {\n' +
        '    let v = 0;\n' +
        '    await browser.waitUntil(async () => { v = await read(); return v === 1; });\n' +
        '    expect(v).toBe(1);\n' +
        '  });',
    );

    expect(assertionLessCases(source)).toEqual([]);
  });

  it('does not count an expect that appears only in a comment', () => {
    const source = wrap(
      '  it("commented out", async () => {\n' +
        '    // expect(v).toBe(1);\n' +
        '    await go();\n' +
        '  });',
    );

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['commented out']);
  });

  it('does not count an expect that appears only inside a string', () => {
    const source = wrap(
      '  it("stringy", async () => {\n' +
        '    await go("expect(v).toBe(1)");\n' +
        '  });',
    );

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['stringy']);
  });

  it('accepts an await-style assertion', () => {
    const source = wrap(
      '  it("awaited", async () => {\n' +
        '    await expect($$(".x")).toBeElementsArrayOfSize(0);\n' +
        '  });',
    );

    expect(assertionLessCases(source)).toEqual([]);
  });

  it('flags a nested case, so a describe cannot hide one', () => {
    const source = wrap(
      '  describe("inner", () => {\n' +
        '    it("hidden", async () => {\n' +
        '      await browser.waitUntil(async () => true);\n' +
        '    });\n' +
        '  });',
    );

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['hidden']);
  });

  it('reports an unterminated case rather than skipping it', () => {
    const source = 'describe("s", () => {\n  it("truncated", async () => {\n    await go();\n';

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['truncated']);
  });
});

describe('isScannedSpec', () => {
  it('scans a committed e2e spec', () => {
    expect(isScannedSpec('test/specs/gantt-calendar-shading.e2e.ts')).toBe(true);
  });

  it('skips the gitignored local probes', () => {
    expect(isScannedSpec('test/specs/_local-keepopen.e2e.ts')).toBe(false);
    expect(isScannedSpec('test/specs/_local-clone-search.e2e.ts')).toBe(false);
  });

  it('skips a path that merely contains the local prefix deeper down', () => {
    expect(isScannedSpec('test/specs/nested/_local-thing.e2e.ts')).toBe(false);
  });

  it('skips non-spec files', () => {
    expect(isScannedSpec('test/unit/foo.test.ts')).toBe(false);
    expect(isScannedSpec('src/main.ts')).toBe(false);
  });

  it('normalises windows separators', () => {
    expect(isScannedSpec('test\\specs\\gantt-calendar-shading.e2e.ts')).toBe(true);
    expect(isScannedSpec('test\\specs\\_local-keepopen.e2e.ts')).toBe(false);
  });
});
