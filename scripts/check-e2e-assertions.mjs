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
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Committed e2e specs only. The `_local-` probes are gitignored debug tools
 * pointing at private vaults, so they would false-fail a local run. Scoped to
 * direct children of the spec directory, exactly as the gitignore and the eslint
 * ignore are — reading wider would skip a nested file that IS committed.
 */
export function isScannedSpec(path) {
  const normalized = path.replaceAll('\\', '/');
  if (!normalized.endsWith('.e2e.ts')) return false;
  return !/(^|\/)test\/specs\/_local-[^/]*$/.test(normalized);
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
function calleeName(node) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (ts.isIdentifier(callee.expression)) {
    return GLOBAL_HOSTS.has(callee.expression.text) ? callee.name.text : callee.expression.text;
  }
  return null;
}

const CASE_CALLEES = new Set(['it', 'test']);

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
    if (ts.isCallExpression(child) && calleeName(child) === 'expect' && invokesMatcher(child)) {
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

function specFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // The ignore pattern covers directories too, along with everything under
    // them — descending into one would scan probes git never tracked.
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('_local-')) found.push(...specFiles(path));
    } else if (isScannedSpec(path)) {
      found.push(path);
    }
  }
  return found;
}

function main() {
  const offenders = [];
  for (const file of specFiles(join('test', 'specs'))) {
    for (const { name, line } of assertionLessCases(readFileSync(file, 'utf8'), file)) {
      offenders.push(`${file.replaceAll('\\', '/')}:${line}  ${name}`);
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
