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
 * Scanning is structural rather than line-shaped. Cases live at whatever indent
 * their enclosing describes give them, and `});` closes hooks and describes too,
 * so an indent heuristic would quietly skip every nested case — a checker with a
 * blind spot is worse than none, because it reports coverage it never looked at.
 * Instead each case declaration is found outside strings, comments and regex
 * literals, and its body is the text up to its own balanced parenthesis.
 *
 * Every ambiguity resolves toward reporting: a case whose body cannot be
 * delimited is reported rather than skipped.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Committed e2e specs only. The `_local-` probes are gitignored debug tools
 * pointing at private vaults, so they would false-fail a local run.
 *
 * Scoped to direct children of the spec directory, exactly as the gitignore and
 * the eslint ignore are. Excluding the prefix at any depth would read wider than
 * the ignores it mirrors, and a nested file carrying that name IS committed —
 * skipping it would hand a real spec a way around this gate.
 */
export function isScannedSpec(path) {
  const normalized = path.replaceAll('\\', '/');
  if (!normalized.endsWith('.e2e.ts')) return false;
  return !/(^|\/)test\/specs\/_local-[^/]*$/.test(normalized);
}

/**
 * Case declarations. The lookbehind rejects a property access, so `helper.it(`
 * and a regex's `.test(` are not mistaken for cases — the latter matters because
 * this repo calls `.test(` far more often than it declares a `test(`.
 */
const CASE_PATTERN = /(?<![.\w$])(?:it|test)(?:\.only|\.skip)?\s*\(/g;

/** Words after which a `/` still opens a regex rather than dividing. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'new',
]);

/**
 * An assertion is `expect(...)` followed by a matcher. A bare `expect(value)`
 * invokes nothing and asserts nothing, so requiring the member access is what
 * separates a real check from a call that merely mentions the word.
 */
const ASSERTION_PATTERN = /\bexpect\s*\([\s\S]*?\)\s*\.\s*(?:not|resolves|rejects|to[A-Z])/;

/**
 * Whether the `/` at this offset opens a regex literal rather than dividing.
 * Decided by the last meaningful character before it: a value cannot be followed
 * by a regex, so after one a slash is division. Reading this wrong in the
 * permissive direction blanks real code; reading it wrong in the strict
 * direction leaves a regex's parentheses to unbalance a case body.
 */
function opensRegex(source, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return true;
  if (/[)\]}]/.test(source[i])) return false;
  if (!/[\w$]/.test(source[i])) return true;
  let start = i;
  while (start >= 0 && /[\w$]/.test(source[start])) start -= 1;
  return REGEX_PRECEDING_KEYWORDS.has(source.slice(start + 1, i + 1));
}

/** Offset just past a line comment starting at `index`. */
function endOfLineComment(source, index) {
  const end = source.indexOf('\n', index);
  return end === -1 ? source.length : end;
}

/** Offset just past a block comment starting at `index`. */
function endOfBlockComment(source, index) {
  const end = source.indexOf('*/', index + 2);
  return end === -1 ? source.length : end + 2;
}

/**
 * Offset just past the closing quote of the string starting at `index`. A
 * template literal's `${...}` is code that may hold further literals, so the
 * interpolation is skipped whole — otherwise an inner backtick would close the
 * outer literal early and leave the rest of its text scanned as code.
 */
function endOfString(source, index) {
  const quote = source[index];
  const template = quote === '`';
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (template && source[i] === '$' && source[i + 1] === '{') {
      i = endOfInterpolation(source, i + 1);
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

/** Offset just past the `}` closing the interpolation whose `{` sits at `index`. */
function endOfInterpolation(source, index) {
  let depth = 0;
  let i = index;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'" || char === '`') { i = endOfString(source, i); continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return source.length;
}

/**
 * Offset just past the closing delimiter of the regex starting at `index`. A
 * slash inside a character class does not close the literal.
 */
function endOfRegex(source, index) {
  let i = index + 1;
  let inClass = false;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') { i += 2; continue; }
    if (char === '\n') return i;
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return i + 1;
    i += 1;
  }
  return source.length;
}

/** Where the non-code construct at `index` ends, or -1 when code starts there. */
function endOfNonCode(source, index) {
  const char = source[index];
  const next = source[index + 1];
  if (char === '/' && next === '/') return endOfLineComment(source, index);
  if (char === '/' && next === '*') return endOfBlockComment(source, index);
  if (char === '"' || char === "'" || char === '`') return endOfString(source, index);
  if (char === '/' && opensRegex(source, index)) return endOfRegex(source, index);
  return -1;
}

/**
 * The source with strings, template literals, comments and regex literals blanked
 * to spaces, so scanning sees only real code. Length and line breaks are
 * preserved, so every offset still maps back to the original text.
 */
function blankNonCode(source) {
  const out = source.split('');
  let index = 0;
  while (index < source.length) {
    const end = endOfNonCode(source, index);
    if (end === -1) {
      index += 1;
      continue;
    }
    for (let i = index; i < end; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
    index = Math.max(end, index + 1);
  }
  return out.join('');
}

/** The first string literal after the opening paren — the case name. */
function readCaseName(source, openParen) {
  const match = /^\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(source.slice(openParen + 1, openParen + 400));
  return match ? match[2] : '<unnamed>';
}

/** Offset just past the parenthesis that balances the one at `openParen`. */
function endOfCall(code, openParen) {
  let depth = 0;
  for (let i = openParen; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return code.length;
}

/**
 * Every test case in the source, each with its name, its body, and the 1-based
 * line it starts on. A case whose parentheses never balance keeps the rest of the
 * file as its body rather than being dropped.
 */
export function findTestCases(source) {
  const code = blankNonCode(source);
  const cases = [];
  CASE_PATTERN.lastIndex = 0;
  let match;
  while ((match = CASE_PATTERN.exec(code)) !== null) {
    const openParen = match.index + match[0].length - 1;
    const end = endOfCall(code, openParen);
    cases.push({
      name: readCaseName(source, openParen),
      body: source.slice(openParen + 1, end),
      codeBody: code.slice(openParen + 1, end),
      line: source.slice(0, match.index).split('\n').length,
    });
    CASE_PATTERN.lastIndex = end;
  }
  return cases;
}

/**
 * The cases that assert nothing. An `expect` inside a string, a comment or a
 * regex does not count, and neither does one with no matcher attached.
 */
export function assertionLessCases(source) {
  return findTestCases(source)
    .filter((testCase) => !ASSERTION_PATTERN.test(testCase.codeBody))
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
    for (const { name, line } of assertionLessCases(readFileSync(file, 'utf8'))) {
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
