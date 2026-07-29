import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  assertionLessCases,
  findTestCases,
  importedModuleSpecifiers,
  isScannedSpec,
  loadedModules,
  UnreadableLoad,
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

  it('is undisturbed by parentheses inside strings and template literals', () => {
    const source = wrap(
      '  it("epsilon", async () => {\n' +
        '    const s = "a ) ( b";\n' +
        '    const t = `x ${fn(")")} y`;\n' +
        '    expect(s).toBe(t);\n' +
        '  });',
    );

    const cases = findTestCases(source);

    expect(cases.map((c) => c.name)).toEqual(['epsilon']);
    expect(cases[0]!.asserts).toBe(true);
  });

  it('names a case whose title is not a plain literal rather than dropping it', () => {
    const source = wrap('  it(`kappa ${n}`, () => { expect(1).toBe(1); });');

    expect(findTestCases(source).map((c) => c.name)).toEqual(['<unnamed>']);
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
    expect(isScannedSpec('gantt-calendar-shading.e2e.ts')).toBe(true);
  });

  it('skips the gitignored local probes', () => {
    expect(isScannedSpec('_local-keepopen.e2e.ts')).toBe(false);
    expect(isScannedSpec('_local-clone-search.e2e.ts')).toBe(false);
  });

  it('scans a nested spec even when its name carries the local prefix', () => {
    // The exclusion mirrors the gitignore and eslint ignore, both of which cover
    // only direct children of test/specs. A nested file is committed, so
    // excluding it would let a real spec bypass the gate.
    expect(isScannedSpec('nested/_local-thing.e2e.ts')).toBe(true);
  });

  it('skips files that are not TypeScript modules', () => {
    // Paths are relative to the scan root, which the walk never leaves — so the
    // only question here is the extension.
    expect(isScannedSpec('fixture.json')).toBe(false);
    expect(isScannedSpec('notes.md')).toBe(false);
    expect(isScannedSpec('vault/Task.md')).toBe(false);
  });

  it('normalises windows separators', () => {
    expect(isScannedSpec('nested\\gantt-calendar-shading.e2e.ts')).toBe(true);
    expect(isScannedSpec('_local-probes\\case.e2e.ts')).toBe(false);
  });

  it('scans a path whose nested directories merely repeat the root name', () => {
    // Anchored to the scan root, so a name that echoes it deeper down is
    // ordinary committed code rather than an ignored probe.
    expect(isScannedSpec('nested/test/specs/_local-bypass.e2e.ts')).toBe(true);
  });
});

describe('cases the file defines for itself', () => {
  it('ignores a call to a locally declared function that shares mocha name', () => {
    const source = [
      'const it = (name: string, run: () => void) => run();',
      'it("ordinary code, not a case", () => {});',
    ].join('\n');

    expect(findTestCases(source)).toEqual([]);
  });

  it('ignores a shadowing declaration in an enclosing scope', () => {
    const source = [
      'function helper() {',
      '  const test = (name: string, run: () => void) => run();',
      '  test("still not a case", () => {});',
      '}',
    ].join('\n');

    expect(findTestCases(source)).toEqual([]);
  });

  it('still counts a case when the name is imported, which is mocha own', () => {
    // A spec naming the runner's function explicitly is using that very
    // function. Reading the import as a local binding would switch the gate off
    // across the suite while it went on reporting clean.
    const source = ['import { it } from "@wdio/globals";', 'it("a real case", () => {});'].join('\n');

    expect(findTestCases(source).map((c) => c.name)).toEqual(['a real case']);
  });

  it('still counts a case when the shadow sits in a scope that does not enclose it', () => {
    // The walk goes up from the call, not across the file. A shadow somewhere
    // else must not quietly switch off the cases that are real, which is the
    // one direction of error worth more than every case this could catch.
    const source = [
      'function helper() { const it = (name: string, run: () => void) => run(); }',
      'it("a real case", () => {});',
    ].join('\n');

    expect(findTestCases(source).map((c) => c.name)).toEqual(['a real case']);
  });

  it('still counts a case that sits beside an unrelated local name', () => {
    const source = ['const helper = () => {};', 'it("a real case", () => {});'].join('\n');

    expect(findTestCases(source).map((c) => c.name)).toEqual(['a real case']);
  });
});

describe('assertion shape', () => {
  const wrapCase = (body: string): string =>
    `describe("s", () => {\n  it("c", async () => {\n${body}\n  });\n});\n`;

  it('rejects a call on the expect chain that is not a matcher', () => {
    expect(assertionLessCases(wrapCase('    expect(1).toString();')).map((c) => c.name)).toEqual([
      'c',
    ]);
  });

  it('rejects a matcher name that is only read, then something else called', () => {
    expect(
      assertionLessCases(wrapCase('    expect(1).toBe.toString();')).map((c) => c.name),
    ).toEqual(['c']);
  });

  it('accepts a modifier followed by a matcher', () => {
    expect(assertionLessCases(wrapCase('    expect(1).not.toBe(2);'))).toEqual([]);
  });

  it('finds a case declared through a global host', () => {
    const source = 'describe("s", () => {\n  globalThis.it("g", () => {});\n});\n';

    expect(findTestCases(source).map((c) => c.name)).toEqual(['g']);
  });

  it('still ignores an ordinary property access that merely ends in it', () => {
    const source = 'describe("s", () => {\n  helper.it("h", () => {});\n});\n';

    expect(findTestCases(source)).toEqual([]);
  });
});

describe('case forms and expect shapes', () => {
  const wrapCase = (call: string): string => `describe("s", () => {\n  ${call}\n});\n`;

  it.each(['specify', 'xit', 'xspecify'])('finds a %s case', (form) => {
    expect(findTestCases(wrapCase(`${form}("f", () => {});`)).map((c) => c.name)).toEqual(['f']);
  });

  it('finds a case under a qualified global host modifier', () => {
    expect(findTestCases(wrapCase('globalThis.it.only("q", () => {});')).map((c) => c.name)).toEqual(
      ['q'],
    );
  });

  it('does not treat expect.any as an expectation', () => {
    const source = wrapCase(
      'it("a", () => { const m = expect.any(Number).toAsymmetricMatcher(); void m; });',
    );

    expect(assertionLessCases(source).map((c) => c.name)).toEqual(['a']);
  });
});

describe('shared suites', () => {
  it('scans a sibling module that is not itself a spec', () => {
    // A spec can import a helper that registers cases; mocha runs them, so the
    // gate must open the helper too rather than trusting the filename.
    expect(isScannedSpec('shared-suite.ts')).toBe(true);
    expect(isScannedSpec('helpers/journeys.ts')).toBe(true);
  });

  it('still ignores declaration files and non-TypeScript', () => {
    expect(isScannedSpec('globals.d.ts')).toBe(false);
    expect(isScannedSpec('fixture.json')).toBe(false);
  });
});

describe('importedModuleSpecifiers', () => {
  it('collects import and re-export specifiers', () => {
    const source = [
      'import { a } from "./sibling";',
      'import b from "../shared/journeys";',
      'export * from "./more";',
    ].join('\n');

    expect(importedModuleSpecifiers(source)).toEqual(['./sibling', '../shared/journeys', './more']);
  });

  it('collects a bare specifier too, because an alias can name a local module', () => {
    // Under the committed "@/*" path alias this names src/e2e-shared. Judging a
    // specifier by its first character would discard it as though it named a
    // package; only the resolver can tell the two apart.
    expect(importedModuleSpecifiers('import "@/e2e-shared";')).toEqual(['@/e2e-shared']);
  });

  it('collects a dynamic import, wherever in the file it sits', () => {
    const source = 'describe("s", () => {\n  before(async () => { await import("./suite"); });\n});';

    expect(importedModuleSpecifiers(source)).toEqual(['./suite']);
  });

  it('collects a require call', () => {
    expect(importedModuleSpecifiers('require("./suite");')).toEqual(['./suite']);
  });

  it('skips a type-only import, which is erased before anything runs', () => {
    const source = ['import type { Fixture } from "./types";', 'import "./suite";'].join('\n');

    expect(importedModuleSpecifiers(source)).toEqual(['./suite']);
  });

  it('skips a type-only re-export for the same reason', () => {
    const source = ['export type * from "./types";', 'export * from "./suite";'].join('\n');

    expect(importedModuleSpecifiers(source)).toEqual(['./suite']);
  });

  it('skips an import whose every named binding is inline-type', () => {
    const source = ['import { type A, type B } from "./types";', 'import "./suite";'].join('\n');

    expect(importedModuleSpecifiers(source)).toEqual(['./suite']);
  });

  it('keeps an import that binds a value alongside an inline type', () => {
    expect(importedModuleSpecifiers('import { go, type A } from "./suite";')).toEqual(['./suite']);
  });

  it('keeps an import with a default binding beside inline types', () => {
    expect(importedModuleSpecifiers('import go, { type A } from "./suite";')).toEqual(['./suite']);
  });

  it('keeps a side-effect import, which exists only to run', () => {
    expect(importedModuleSpecifiers('import "./suite";')).toEqual(['./suite']);
  });

  it('skips a re-export whose every named binding is inline-type', () => {
    const source = ['export { type A } from "./types";', 'export * from "./suite";'].join('\n');

    expect(importedModuleSpecifiers(source)).toEqual(['./suite']);
  });

  it('keeps a re-export that carries a value alongside an inline type', () => {
    expect(importedModuleSpecifiers('export { go, type A } from "./suite";')).toEqual(['./suite']);
  });

  it('collects an import-equals require, which loads at runtime', () => {
    expect(importedModuleSpecifiers('import suite = require("./suite");')).toEqual(['./suite']);
  });

  it('refuses a dynamic import it cannot read rather than passing over it', () => {
    // Guessing which file a computed specifier names would mean reporting clean
    // over whatever it is, so the scan says out loud that it cannot see.
    expect(() => importedModuleSpecifiers('await import("./" + name);', 'entry.e2e.ts')).toThrow(
      /entry\.e2e\.ts:1 loads a module through an expression/,
    );
  });

  it('refuses a computed require for the same reason', () => {
    expect(() => importedModuleSpecifiers('require(base + "/suite");')).toThrow(UnreadableLoad);
  });

  it('leaves a locally defined require alone, whatever it is passed', () => {
    // A helper that merely shares the name loads no module, so failing the build
    // over what it is handed would refuse code that is entirely fine.
    const source = ['const require = (spec: unknown) => spec;', 'require({ any: "thing" });'].join('\n');

    expect(importedModuleSpecifiers(source)).toEqual([]);
  });

  it('reads a template literal that has no substitution, which names one file', () => {
    expect(importedModuleSpecifiers('await import(`./suite`);')).toEqual(['./suite']);
  });

  it('ignores a type-position import, which loads nothing', () => {
    const source = 'let x: import("./types").Fixture;';

    expect(importedModuleSpecifiers(source)).toEqual([]);
  });
});

describe('loadedModules', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'e2e-assertion-gate-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (name: string, source: string): string => {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, 'utf8');
    return file;
  };

  /** What was reached, by filename — the temp root itself carries no meaning. */
  const reachedFrom = (entry: string): string[] =>
    loadedModules([entry])
      .map((file) => basename(file))
      .sort();

  it('reaches a module named by a plain relative specifier', () => {
    write('helper.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'import { go } from "./helper.ts";\ngo();\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts', 'helper.ts']);
  });

  it('reaches a module named without an extension', () => {
    write('helper.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'import { go } from "./helper";\ngo();\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts', 'helper.ts']);
  });

  it('reaches a directory import through its index', () => {
    write('suite/index.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'import { go } from "./suite";\ngo();\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts', 'index.ts']);
  });

  it('reaches the TypeScript file an ESM ".js" specifier names', () => {
    // Under ESM a TypeScript module is imported by its EMITTED name, so `./x.js`
    // names `x.ts`. Nothing about the specifier text says so; only the compiler's
    // resolver knows, and a hand-rolled candidate list drops this one silently.
    write('helper.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'import { go } from "./helper.js";\ngo();\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts', 'helper.ts']);
  });

  it('reaches a module through a re-export rather than an import', () => {
    write('cases.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'export * from "./cases";\n');

    expect(reachedFrom(entry)).toEqual(['cases.ts', 'entry.e2e.ts']);
  });

  it('terminates when two modules import each other', () => {
    write('a.ts', 'import "./b";\nexport const a = 1;\n');
    write('b.ts', 'import "./a";\nexport const b = 1;\n');
    const entry = write('entry.e2e.ts', 'import "./a";\n');

    expect(reachedFrom(entry)).toEqual(['a.ts', 'b.ts', 'entry.e2e.ts']);
  });

  it('fails loudly when a queued file cannot be read', () => {
    // Every file reaching the read was proved to exist, so a failure here means
    // the scan cannot see a module the runner loads. Reporting clean over it is
    // the single outcome the gate exists to rule out.
    expect(() => loadedModules([root])).toThrow();
  });

  it('keeps the entrypoint when a specifier names no file at all', () => {
    const entry = write('entry.e2e.ts', 'import "./absent";\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts']);
  });

  it('reaches a suite loaded by a dynamic import', () => {
    write('suite.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'before(async () => { await import("./suite"); });\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts', 'suite.ts']);
  });

  it('does not descend into a dependency named as a package', () => {
    // The package is written into the fixture so the specifier genuinely
    // RESOLVES. Naming a package absent from the fixture would pass just as
    // well by resolving to nothing, proving the guard nothing at all.
    write('node_modules/vendor/suite.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'import "vendor/suite";\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts']);
  });

  it('does not descend into node_modules reached by a relative path', () => {
    // Walked into by hand rather than named as a package, and still recognised
    // as a dependency — the compiler's flag does not go by the spelling either.
    write('node_modules/vendor/suite.ts', 'export const go = () => {};\n');
    const entry = write('entry.e2e.ts', 'import "./node_modules/vendor/suite";\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts']);
  });

  it('reaches a suite named through the project path alias', () => {
    // "@/*" maps to src/*, so this names a real file in this repository. The
    // temp entrypoint proves the alias is honoured wherever the importer sits.
    const entry = write('entry.e2e.ts', 'import "@/releaseNotes";\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts', 'releaseNotes.ts']);
  });

  it('reaches a suite that lives outside the spec tree entirely', () => {
    // The reach a directory walk cannot have: the shared module sits above the
    // scanned root, and only the import edge says it runs.
    write('shared/journeys.ts', 'export const go = () => {};\n');
    const entry = write('specs/entry.e2e.ts', 'import { go } from "../shared/journeys";\ngo();\n');

    expect(reachedFrom(entry)).toEqual(['entry.e2e.ts', 'journeys.ts']);
  });
});
