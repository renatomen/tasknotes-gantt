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

  it('finds a test() case, since an unrecognised case form would go unchecked', () => {
    const source = wrap('  test("eta", () => { expect(1).toBe(1); });');

    expect(findTestCases(source).map((c) => c.name)).toEqual(['eta']);
  });

  it('does not mistake a regex .test( call for a case', () => {
    const source = wrap(
      '  it("theta", () => {\n' +
        '    expect(/due:/.test("due: x")).toBe(true);\n' +
        '  });',
    );

    expect(findTestCases(source).map((c) => c.name)).toEqual(['theta']);
  });

  it('does not mistake a property access like obj.it( for a case', () => {
    const source = wrap('  helper.it("iota", () => {});');

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

  it('is not truncated by a closing paren inside a regex literal', () => {
    const source = wrap(
      '  it("regexy", async () => {\n' +
        '    const r = /\\)/;\n' +
        '    expect(r.test(")")).toBe(true);\n' +
        '  });',
    );

    expect(assertionLessCases(source)).toEqual([]);
  });

  it('does not let an opening paren in a regex swallow the next case and borrow its assertion', () => {
    const source = wrap(
      '  it("bare", async () => {\n' +
        '    const r = /\\(/;\n' +
        '    await go(r);\n' +
        '  });\n' +
        '  it("asserts", async () => {\n' +
        '    expect(1).toBe(1);\n' +
        '  });',
    );

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['bare']);
  });

  it('treats division as division, not as the start of a regex', () => {
    const source = wrap(
      '  it("divides", async () => {\n' +
        '    const ratio = width / height;\n' +
        '    const other = a / b;\n' +
        '    expect(ratio).toBeGreaterThan(other);\n' +
        '  });',
    );

    expect(assertionLessCases(source)).toEqual([]);
  });

  it('handles an escaped slash and a slash inside a character class', () => {
    const source = wrap(
      '  it("slashy", async () => {\n' +
        '    const a = /x\\/y/;\n' +
        '    const b = /[/]/;\n' +
        '    expect(a).not.toEqual(b);\n' +
        '  });',
    );

    expect(assertionLessCases(source)).toEqual([]);
  });

  it('does not count an expect hidden inside a nested template literal', () => {
    const source = wrap(
      '  it("nested template", async () => {\n' +
        '    const msg = `outer ${`inner expect(1).toBe(1)`} end`;\n' +
        '    await go(msg);\n' +
        '  });',
    );

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['nested template']);
  });

  it('does not accept a bare expect with no matcher', () => {
    const source = wrap('  it("no matcher", async () => {\n    expect(await read());\n  });');

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['no matcher']);
  });

  it('accepts the matcher forms the suite actually uses', () => {
    for (const call of [
      'expect(v).toBe(1);',
      'expect(v).not.toBeNull();',
      'await expect($$(".x")).toBeElementsArrayOfSize(0);',
      'await expect(p).resolves.toBe(1);',
      'expect(v)\n      .toEqual(w);',
    ]) {
      const source = wrap(`  it("m", async () => {\n    ${call}\n  });`);

      expect(assertionLessCases(source)).toEqual([]);
    }
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

  it('scans a nested spec even when its name carries the local prefix', () => {
    // The exclusion mirrors the gitignore and eslint ignore, both of which cover
    // only direct children of test/specs. A nested file is committed, so
    // excluding it would let a real spec bypass the gate.
    expect(isScannedSpec('test/specs/nested/_local-thing.e2e.ts')).toBe(true);
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
