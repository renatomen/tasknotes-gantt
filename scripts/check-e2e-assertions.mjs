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
 * Instead each `it(` is found outside strings and comments, and its body is the
 * text up to its own balanced closing parenthesis.
 *
 * Every ambiguity resolves toward reporting: a case whose body cannot be
 * delimited is reported rather than skipped.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Committed e2e specs only. The `_local-` probes are gitignored debug tools. */
export function isScannedSpec(path) {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.endsWith('.e2e.ts')) return false;
  return !normalized.split('/').some((segment) => segment.startsWith('_local-'));
}

const CASE_PATTERN = /\bit(?:\.only|\.skip)?\s*\(/g;

/**
 * The source with string literals, template literals and comments blanked to
 * spaces, so scanning sees only real code. Length and line breaks are preserved
 * so every offset still maps back to the original text.
 */
function blankNonCode(source) {
  const out = source.split('');
  let index = 0;
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      blank(index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      let i = index + 1;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === char) break;
        i += 1;
      }
      blank(index + 1, i);
      index = i + 1;
      continue;
    }
    index += 1;
  }
  return out.join('');
}

/** The first string literal after `it(` — the case name. */
function readCaseName(source, openParen) {
  const rest = source.slice(openParen + 1, openParen + 400);
  const match = /^\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(rest);
  return match ? match[2] : '<unnamed>';
}

/**
 * Every test case in the source, each with its name, its body text, and the
 * 1-based line it starts on. A case whose parentheses never balance is returned
 * with the rest of the file as its body rather than dropped.
 */
export function findTestCases(source) {
  const code = blankNonCode(source);
  const cases = [];
  CASE_PATTERN.lastIndex = 0;
  let match;
  while ((match = CASE_PATTERN.exec(code)) !== null) {
    const openParen = match.index + match[0].length - 1;
    let depth = 0;
    let end = code.length;
    for (let i = openParen; i < code.length; i += 1) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
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

/** The cases that assert nothing. `expect` inside a string or comment does not count. */
export function assertionLessCases(source) {
  return findTestCases(source)
    .filter((testCase) => !/\bexpect\s*\(/.test(testCase.codeBody))
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
    const source = readFileSync(file, 'utf8');
    for (const { name, line } of assertionLessCases(source)) {
      offenders.push(`${file.replace(/\\/g, '/')}:${line}  ${name}`);
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
