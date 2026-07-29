#!/usr/bin/env node
/**
 * CI gate: every e2e test case must assert something.
 *
 *   node scripts/check-e2e-assertions.mjs
 *
 * A case that only awaits a `waitUntil` looks like a test and is not one. The
 * wait proves that something settled; it does not prove what it settled TO, so
 * the case passes whenever the predicate is satisfiable at all — including by a
 * value nobody intended. Requiring a real assertion is what makes the difference
 * between "the page stopped changing" and "the page shows what it should".
 *
 * Cases are found through the TypeScript compiler's own parser rather than by
 * matching text. An earlier hand-rolled scanner had to know which `/` opened a
 * regex, where a nested template literal ended, and which `});` closed a case —
 * and got each of them wrong in turn, at one point ending discovery 11 cases
 * early while reporting the file clean. A checker with a blind spot is worse
 * than no checker, because it reports coverage it never looked at. The parser
 * that compiles this code already knows all of it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/** Where the scan starts; every exclusion below is relative to exactly this. */
export const SPEC_ROOT = join('test', 'specs');

/**
 * Whether a spec is scanned, given its path RELATIVE to the spec root.
 *
 * The `_local-` probes are gitignored debug tools pointing at private vaults, so
 * they would false-fail a local run — but the ignore pattern covers only direct
 * children of the spec root. Deciding on a relative path anchors that: matching
 * the absolute path instead would exclude a committed
 * `nested/test/specs/_local-x.e2e.ts`, whose name merely repeats the root.
 */
export function isScannedSpec(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  // Every TypeScript module under the root, not only `.e2e.ts`. A spec may share
  // a suite by importing a sibling that registers cases of its own; mocha runs
  // those, so a gate keyed on the spec filename would report clean over cases it
  // never opened. A module with no cases simply contributes none.
  if (!normalized.endsWith('.ts') || normalized.endsWith('.d.ts')) return false;
  return !normalized.split('/')[0]?.startsWith('_local-');
}

/** The relative module specifiers a source imports or re-exports. */
export function relativeImports(source, fileName = 'module.ts') {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  for (const statement of tree.statements) {
    const clause = statement.moduleSpecifier;
    if (!clause || !ts.isStringLiteral(clause)) continue;
    if (clause.text.startsWith('.')) specifiers.push(clause.text);
  }
  return specifiers;
}

/**
 * Bundler resolution deliberately: it is the most permissive mode, and a gate
 * should fail toward opening more files rather than fewer.
 */
const RESOLUTION_OPTIONS = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
};

/**
 * Resolve a relative specifier to the file it names, or null if it names none.
 *
 * The compiler's own resolver, not a reconstruction of it. A hand-rolled loop
 * over `x`, `x.ts`, `x/index.ts` looks complete and is not: under ESM a
 * TypeScript module is imported as `./x.js`, which resolves to `x.ts` — a rule
 * no filename inspection would arrive at. That form dropped out silently, and a
 * scan that silently narrows itself is the one failure this whole file exists to
 * prevent.
 *
 * Null is safe to skip. A relative specifier that resolves to nothing cannot
 * register a case, because the runner would fail to load the importing spec at
 * all rather than run it green.
 */
function resolveModule(fromFile, specifier) {
  const { resolvedModule } = ts.resolveModuleName(specifier, fromFile, RESOLUTION_OPTIONS, ts.sys);
  // The compiler answers in forward slashes on every platform; `resolve` puts it
  // back in the host's spelling so one file cannot enter the visited set twice
  // under two names and be reported twice.
  return resolvedModule ? resolve(resolvedModule.resolvedFileName) : null;
}

/**
 * Every module mocha would load for these entrypoints: the specs themselves plus
 * whatever they reach by import, transitively.
 *
 * Following imports rather than walking a directory is the difference between
 * scanning what RUNS and scanning what happens to sit nearby. A shared suite
 * lives wherever its author put it, and one placed outside the spec tree would
 * otherwise register cases this gate never opened.
 */
export function loadedModules(entrypoints) {
  const seen = new Set();
  const queue = [...entrypoints];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue; // a specifier that resolves to nothing cannot register a case
    }
    for (const specifier of relativeImports(source, file)) {
      const resolved = resolveModule(file, specifier);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

/** Globals a case can legitimately be reached through. */
const GLOBAL_HOSTS = new Set(['globalThis', 'global', 'window']);

/**
 * The name a call is made under: `it`, `it.only`, `globalThis.it`, `expect`, …
 *
 * A property access resolves to its leading identifier, so `helper.it(...)`
 * reads as `helper` and is correctly not a case — except through a global host,
 * where `globalThis.it(...)` is the same `it`.
 *
 * Known limit: a case reached through an alias (`const scenario = it`) is not
 * recognised, because that needs symbol resolution rather than syntax. Aliasing
 * a case function is deliberate, not accidental, so the gate targets ordinary
 * code and does not claim to stop someone determined to evade it.
 */
const hostedOn = (node) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  GLOBAL_HOSTS.has(node.expression.text);

function calleeName(node) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  // `globalThis.it(...)` — the host contributes nothing; the name is the case.
  if (hostedOn(callee)) return callee.name.text;
  // `globalThis.it.only(...)` — one level deeper, same answer.
  if (hostedOn(callee.expression)) return callee.expression.name.text;
  // `it.only(...)` and `helper.it(...)` both resolve to their leading name,
  // which is what makes the first a case and the second correctly not one.
  if (ts.isIdentifier(callee.expression)) return callee.expression.text;
  return null;
}

/**
 * A call made under a BARE identifier, ignoring any property access. `expect(v)`
 * is an expectation; `expect.any(Number)` is a value constructor that happens to
 * share the leading name, and treating the two alike would let
 * `expect.any(Number).toAsymmetricMatcher()` read as an assertion.
 */
function isBareCallTo(node, name) {
  return ts.isIdentifier(node.expression) && node.expression.text === name;
}

/** Mocha's BDD case forms. `xit`/`xspecify` are skipped cases, still gated. */
const CASE_CALLEES = new Set(['it', 'test', 'specify', 'xit', 'xspecify']);

/**
 * Matcher naming, by convention: `toBe`, `toContain`, `toBeElementsArrayOfSize`.
 * Modifiers like `not` and `resolves` are not listed because they are never the
 * property being CALLED — they sit mid-chain, and only the called name decides.
 */
const MATCHER_NAME = /^to[A-Z]/;

/**
 * Built-ins that satisfy the matcher shape without asserting anything. `toString`
 * is the obvious one — it begins `to` followed by a capital exactly as every
 * matcher does — and calling it on an expectation is a statement that looks like
 * an assertion from any distance a text search can see.
 */
const NOT_MATCHERS = new Set([
  'toString', 'toLocaleString', 'toJSON', 'toFixed', 'toPrecision', 'toExponential',
  'toISOString', 'toUTCString', 'toDateString', 'toTimeString', 'toLocaleDateString',
  'toLocaleTimeString', 'toLowerCase', 'toUpperCase', 'toSorted', 'toReversed', 'toSpliced',
]);

const isMatcherName = (name) => MATCHER_NAME.test(name) && !NOT_MATCHERS.has(name);

/**
 * Whether an `expect(...)` actually invokes a matcher.
 *
 * Three things are not assertions and all of them look like one from a
 * distance: a bare `expect(value)` checks nothing; `expect(value).toBe` names a
 * matcher without calling it; and `expect(value).toString()` calls something
 * that is not a matcher at all. So the chain must both END in a call and
 * mention a matcher-shaped name along the way.
 */
function invokesMatcher(expectCall) {
  let node = expectCall;
  while (node.parent && ts.isPropertyAccessExpression(node.parent)) {
    node = node.parent;
    if (node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node) {
      // The property actually being invoked decides. Anything earlier in the
      // chain is a modifier, so `expect(v).toBe.toString()` is a toString call
      // that merely passed a matcher name on its way past.
      return isMatcherName(node.name.text);
    }
  }
  return false;
}

/**
 * Whether any call inside this node is an `expect(...)` with a matcher.
 *
 * Nested function bodies count, because the assertions that matter here mostly
 * live in them — a `waitUntil` predicate is a nested arrow that certainly runs.
 * The cost is that an assertion inside a nested function that is NEVER called
 * still satisfies the gate. Reachability is undecidable in general, and jest
 * ships `expect.hasAssertions()` precisely because static analysis cannot
 * answer it, so this raises the floor rather than proving execution: a case
 * with no assertion anywhere becomes impossible, a case whose assertion never
 * runs does not.
 */
function containsAssertion(node) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (ts.isCallExpression(child) && isBareCallTo(child, 'expect') && invokesMatcher(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** The case's title when it is a plain literal, else a placeholder. */
function caseTitle(node) {
  const first = node.arguments[0];
  if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
    return first.text;
  }
  return '<unnamed>';
}

/**
 * Every test case in the source, each with its title and 1-based start line.
 * Nested cases are found wherever they sit — the parser has no notion of indent,
 * which is what an earlier text scanner tripped over.
 */
export function findTestCases(source, fileName = 'spec.e2e.ts') {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const cases = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && CASE_CALLEES.has(calleeName(node) ?? '')) {
      cases.push({
        name: caseTitle(node),
        line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        asserts: containsAssertion(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(tree, visit);
  return cases;
}

/** The cases that assert nothing. */
export function assertionLessCases(source, fileName) {
  return findTestCases(source, fileName)
    .filter((testCase) => !testCase.asserts)
    .map(({ name, line }) => ({ name, line }));
}

/**
 * Every scanned spec, as paths relative to the spec root. Only a DIRECT child of
 * that root can be an ignored probe, so depth is tracked rather than inferred
 * from the path text — a nested directory that happens to repeat the root's name
 * is ordinary committed code.
 */
function specFiles(dir, relative = '') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (relative === '' && entry.name.startsWith('_local-')) continue;
    if (entry.isDirectory()) found.push(...specFiles(join(dir, entry.name), childRelative));
    else if (isScannedSpec(childRelative)) found.push(childRelative);
  }
  return found;
}

function main() {
  const entrypoints = specFiles(SPEC_ROOT)
    .filter((relativePath) => relativePath.endsWith('.e2e.ts'))
    .map((relativePath) => resolve(SPEC_ROOT, relativePath));
  const offenders = [];
  for (const file of loadedModules(entrypoints).sort()) {
    const shown = relative(process.cwd(), file).replaceAll('\\', '/');
    for (const { name, line } of assertionLessCases(readFileSync(file, 'utf8'), file)) {
      offenders.push(`${shown}:${line}  ${name}`);
    }
  }
  if (offenders.length === 0) {
    console.log('e2e assertions OK: every test case asserts something');
    return;
  }
  console.error('e2e cases that assert nothing — a wait proves settling, not correctness:');
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error('Assert on the value the case already polls.');
  process.exit(1);
}

if (process.argv[1]?.endsWith('check-e2e-assertions.mjs')) main();
