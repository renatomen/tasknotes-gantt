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

/** The name a call is made under: `it`, `it.only`, `describe`, `expect`, … */
function calleeName(node) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    return callee.expression.text;
  }
  return null;
}

const CASE_CALLEES = new Set(['it', 'test']);

/**
 * Whether an `expect(...)` actually invokes a matcher. A bare `expect(value)`
 * checks nothing, and `expect(value).toBe` merely names one without calling it;
 * both are statements that mention assertion without making one. Walking up the
 * property-access chain answers this exactly, where matching text could not.
 */
function invokesMatcher(expectCall) {
  let node = expectCall;
  while (node.parent && ts.isPropertyAccessExpression(node.parent)) {
    node = node.parent;
    if (node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node) {
      return true;
    }
  }
  return false;
}

/** Whether any call inside this node is an `expect(...)` with a matcher. */
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
    if (entry.isDirectory()) found.push(...specFiles(path));
    else if (isScannedSpec(path)) found.push(path);
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
