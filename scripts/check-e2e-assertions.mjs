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
import { dirname, join, relative, resolve } from 'node:path';
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

/** Raised when the scan meets a load it cannot follow, rather than passing over it. */
export class UnreadableLoad extends Error {}

/** Whether every name a clause carries is a type, so nothing of it survives. */
function bindsOnlyTypes(clause) {
  if (!clause || !(ts.isNamedImports(clause) || ts.isNamedExports(clause))) return false;
  return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

/**
 * A static import or re-export that still exists at runtime.
 *
 * The rule is simply "what TypeScript erases", and it is spelled four ways:
 * `import type { X } from './y'`, `export type { X } from './y'`, and either of
 * those with the `type` on each name instead of the clause. All are gone before
 * anything executes, so a module reached only that way never registers a case
 * and following it could only fail an otherwise clean run. A default or
 * namespace binding alongside, or a bare `export * from`, means it still runs.
 */
function isRuntimeModuleDeclaration(node) {
  if (ts.isExportDeclaration(node)) {
    return node.isTypeOnly !== true && !bindsOnlyTypes(node.exportClause);
  }
  if (!ts.isImportDeclaration(node)) return false;
  const clause = node.importClause;
  if (clause === undefined) return true; // `import './y'` — loaded for effect
  if (clause.isTypeOnly) return false;
  return clause.name !== undefined || !bindsOnlyTypes(clause.namedBindings);
}

/**
 * `import suite = require('./suite')` — a runtime load in CommonJS-flavoured TS.
 * `import type Suite = require('./suite')` is the same shape and emits nothing.
 */
const externalModuleName = (node) =>
  !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)
    ? node.moduleReference.expression
    : undefined;

const isDynamicImport = (node) =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;

/**
 * CommonJS `require`, and not a function of the file's own that shares the name
 * — otherwise a helper called `require` taking anything but a string literal
 * would fail the build over code that is perfectly fine.
 */
const isRequireCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'require' &&
  !isLocallyDefined(node, 'require');

/**
 * Every module specifier a source loads at runtime, however it spells it.
 *
 * Deliberately not filtered to specifiers beginning with a dot. Which text
 * denotes a local module is a question about this project's resolver
 * configuration, not about the first character: `@/x` is this repository's own
 * `src/x` under the committed path alias, and discarding it as though it named a
 * package would hide every case inside. The specifier's SHAPE decides nothing;
 * where it resolves decides everything, so collection is total and resolution
 * filters.
 *
 * The walk covers the whole tree rather than the top-level statements, because
 * `await import('./suite')` is an expression and can sit anywhere. A type-position
 * `import('./x').Foo` is a distinct node and is correctly not collected.
 */
export function importedModuleSpecifiers(source, fileName = 'module.ts') {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  const collect = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const collectLoadOrRefuse = (call) => {
    const target = call.arguments[0];
    if (target && ts.isStringLiteralLike(target)) {
      specifiers.push(target.text);
      return;
    }
    // A computed specifier still loads a module, and no amount of reading the
    // syntax says which. Guessing would mean reporting clean over whatever it
    // names, so the scan says out loud that it cannot see rather than pretending
    // there is nothing there.
    const { line } = tree.getLineAndCharacterOfPosition(call.getStart(tree));
    throw new UnreadableLoad(
      `${fileName}:${line + 1} loads a module through an expression, so the gate cannot tell ` +
        'which file it reaches. Name the module with a plain string literal.',
    );
  };
  const visit = (node) => {
    if (isRuntimeModuleDeclaration(node)) collect(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node)) collect(externalModuleName(node));
    else if (isDynamicImport(node) || isRequireCall(node)) collectLoadOrRefuse(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(tree, visit);
  return specifiers;
}

/**
 * The project's own resolution settings, so a specifier resolves here exactly as
 * it does for the runner — path aliases included. Bundler mode is forced over
 * whatever the project declares because it is the most permissive available, and
 * a gate that must err should err toward opening more files rather than fewer.
 */
function projectResolutionOptions() {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  const declared = configPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config ?? {},
        ts.sys,
        dirname(configPath),
      ).options
    : {};
  return {
    ...declared,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  };
}

const RESOLUTION_OPTIONS = projectResolutionOptions();

/**
 * A dependency's own test cases are not this suite's to gate.
 *
 * The compiler's flag alone, with no path inspection beside it. A second check
 * for a `node_modules` path segment sat here and could not be made to fail: the
 * flag is set for a bare package name, for a relative path walked into
 * `node_modules` by hand, and for a path alias aimed inside it. Untestable
 * because unreachable — and one more stand-in for a mechanism already present.
 */
const isThirdParty = (resolved) => resolved.isExternalLibraryImport === true;

/**
 * Resolve a specifier to the local file it names, or null if it names none —
 * which covers both an unresolvable specifier and one naming a dependency, whose
 * own test cases are not this suite's to gate.
 *
 * The compiler's own resolver, not a reconstruction of it. A hand-rolled loop
 * over `x`, `x.ts`, `x/index.ts` looks complete and is not: under ESM a
 * TypeScript module is imported as `./x.js`, which resolves to `x.ts` — a rule
 * no filename inspection would arrive at. That form dropped out silently, and a
 * scan that silently narrows itself is the one failure this whole file exists to
 * prevent.
 *
 * Null is safe to skip. A specifier that resolves to nothing cannot register a
 * case, because the runner would fail to load the importing spec at all rather
 * than run it green.
 */
function resolveModule(fromFile, specifier) {
  const { resolvedModule } = ts.resolveModuleName(specifier, fromFile, RESOLUTION_OPTIONS, ts.sys);
  if (!resolvedModule || isThirdParty(resolvedModule)) return null;
  // The compiler answers in forward slashes on every platform; `resolve` puts it
  // back in the host's spelling so one file cannot enter the visited set twice
  // under two names and be reported twice.
  return resolve(resolvedModule.resolvedFileName);
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
    // Deliberately unguarded. Every file queued here was proved to exist, by the
    // directory listing or by the resolver, so a read that fails now means the
    // scan cannot see a module the runner will load. Skipping it quietly is the
    // one outcome this gate exists to rule out, so it fails loudly instead.
    const source = readFileSync(file, 'utf8');
    for (const specifier of importedModuleSpecifiers(source, file)) {
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

/** Every name a binding introduces, reaching into destructuring patterns. */
function addBoundNames(name, names) {
  if (!name) return;
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(name) && !ts.isArrayBindingPattern(name)) return;
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBoundNames(element.name, names);
  }
}

/**
 * `declare const it: ...` describes something that already exists; it does not
 * create it. Reading it as a local binding would hide every real case in a file
 * that types the runner's globals for itself.
 */
const isAmbient = (statement) =>
  statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) === true;

/** Bindings a scope introduces other than through its statement list. */
function scopeBindings(scope) {
  if (ts.isCatchClause(scope)) return scope.variableDeclaration ? [scope.variableDeclaration] : [];
  if (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
    const initializer = scope.initializer;
    return initializer && ts.isVariableDeclarationList(initializer) ? [...initializer.declarations] : [];
  }
  return [];
}

/** The value names a scope introduces. Imports are excluded on purpose. */
function valueNamesDeclaredIn(scope) {
  const names = new Set();
  for (const parameter of ts.isFunctionLike(scope) ? (scope.parameters ?? []) : []) {
    addBoundNames(parameter.name, names);
  }
  for (const binding of scopeBindings(scope)) addBoundNames(binding.name, names);
  for (const statement of scope.statements ?? []) {
    if (isAmbient(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) addBoundNames(declaration.name, names);
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      addBoundNames(statement.name, names);
    }
  }
  return names;
}

/**
 * Whether this file defines the name itself, so the call is its own function
 * rather than the runner's.
 *
 * A module of its own with `const test = (name, run) => run()` registers no case
 * and must not be reported as one. Imports are deliberately NOT treated as
 * shadowing: a spec that writes `import { it } from '@wdio/globals'` is naming
 * the very function mocha would have provided, and counting that as a local
 * binding would switch the gate off across the whole suite while it went on
 * reporting clean — the one outcome worth more than any case it could catch.
 */
function isLocallyDefined(node, name) {
  for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
    if (valueNamesDeclaredIn(scope).has(name)) return true;
  }
  return false;
}

/** Whether a call reaches its function through a global object rather than a bare name. */
function isReachedThroughGlobal(call) {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  return hostedOn(callee) || hostedOn(callee.expression);
}

/**
 * Whether the file's own binding is what this call reaches.
 *
 * Only a bare name can be taken over that way. `globalThis.it(...)` names the
 * property regardless of what the file calls its own variables, so a local `it`
 * beside it hides nothing — and reading it as a shadow would drop a real case.
 */
const isShadowedLocally = (call, name) =>
  !isReachedThroughGlobal(call) && isLocallyDefined(call, name);

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
    const callee = ts.isCallExpression(node) ? (calleeName(node) ?? '') : '';
    if (CASE_CALLEES.has(callee) && !isShadowedLocally(node, callee)) {
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
  let modules;
  try {
    modules = loadedModules(entrypoints).sort();
  } catch (failure) {
    if (!(failure instanceof UnreadableLoad)) throw failure;
    console.error('the e2e assertion gate cannot see the whole suite:');
    console.error(`  ${failure.message}`);
    process.exit(1);
  }
  for (const file of modules) {
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
