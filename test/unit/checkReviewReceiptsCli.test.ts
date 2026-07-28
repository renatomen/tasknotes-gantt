import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The gate's contract, exercised through the real entry point against a
 * throwaway repository.
 *
 * The pure exports are unit-tested elsewhere, but `check()` is where the
 * decisions bind: it reads git's stdin, peels tags, refuses malformed input and
 * exits. None of that is reachable from an import.
 *
 * The repository is built here rather than borrowed from the checkout, because
 * a suite that reads the developer's own receipt store asserts whatever that
 * store happens to contain — recording a receipt would silently flip expected
 * refusals into passes. Controlled commits and a controlled store are what let
 * these cases mean the same thing on every machine.
 */
const SCRIPT = resolve('scripts/check-review-receipts.mjs');
const ZERO = '0'.repeat(40);
const LAYERS = ['ce-code-review', 'codex-local'] as const;

let repo: string;
let docsCommit: string;
let codeCommit: string;
let baseCommit: string;
let tagObject: string;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitFile(path: string, body: string, message: string): string {
  const full = join(repo, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git(['add', path]);
  git(['commit', '-q', '--no-verify', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

/** Put a controlled receipt store in place; `{}` means nothing is receipted. */
function writeReceipts(receipts: Record<string, Record<string, string>>): void {
  writeFileSync(join(repo, '.git', 'review-receipts.json'), JSON.stringify({ receipts }, null, 2));
}

const clean = (): Record<string, string> =>
  Object.fromEntries(LAYERS.map((layer) => [layer, '2026-07-29T00:00:00.000Z']));

/** `stdin` as text, or a raw descriptor when the point is how the read behaves. */
function runCheck(stdin: string | number): Run {
  const options =
    typeof stdin === 'number'
      ? { cwd: repo, encoding: 'utf8' as const, stdio: [stdin, 'pipe', 'pipe'] as const }
      : { cwd: repo, input: stdin, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };
  try {
    const stdout = execFileSync('node', [SCRIPT, 'check'], options);
    return { status: 0, stdout: stdout ?? '', stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

const refLine = (local: string, remote: string, ref = 'refs/heads/probe'): string =>
  `${ref} ${local} ${ref} ${remote}\n`;

const short = (sha: string): string => sha.slice(0, 7);

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'receipts-gate-'));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'probe@example.invalid']);
  git(['config', 'user.name', 'Probe']);
  git(['config', 'commit.gpgsign', 'false']);
  baseCommit = commitFile('README.md', 'base\n', 'base');
  codeCommit = commitFile('src/thing.ts', 'export const a = 1;\n', 'code');
  docsCommit = commitFile('docs/note.md', 'prose\n', 'docs');
  // Tagged in setup, not in a test, so no case depends on another having run.
  git(['tag', '-a', '-m', 'probe', 'probe-tag', codeCommit]);
  tagObject = git(['rev-parse', 'refs/tags/probe-tag']);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

beforeEach(() => writeReceipts({}));

describe('check-review-receipts check', () => {
  it('refuses a pushed commit that holds no receipts', () => {
    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('missing clean review receipts');
    expect(run.stderr).toContain(short(docsCommit));
  });

  it('allows a push whose commit holds both receipts', () => {
    // Without this the gate could refuse every normal push and the rest of the
    // suite would still be green — it would be a wall, not a gate.
    writeReceipts({ [docsCommit]: clean() });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('review receipts OK');
  });

  it('refuses a push whose range changes only docs, since no exemption exists', () => {
    // The range is fully resolvable — base is a real commit the destination has —
    // so this is precisely the push a docs-only exemption would have let through.
    // Mutation-checked: reinstating the exemption makes this case, and only this
    // case, fail.
    expect(git(['diff', '--name-only', codeCommit, docsCommit])).toBe('docs/note.md');

    const run = runCheck(refLine(docsCommit, codeCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(short(docsCommit));
  });

  // Parameterised over BOTH layers: a gate that demanded only one of them would
  // pass a suite that always withheld the same one.
  it.each(LAYERS)('refuses when %s is the only layer recorded', (present) => {
    const missing = LAYERS.find((layer) => layer !== present)!;
    writeReceipts({ [docsCommit]: { [present]: '2026-07-29T00:00:00.000Z' } });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(missing);
  });

  it('gates EVERY pushed sha, naming each unreceipted one', () => {
    const run = runCheck(
      refLine(docsCommit, baseCommit, 'refs/heads/a') + refLine(codeCommit, baseCommit, 'refs/heads/b'),
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(short(docsCommit));
    expect(run.stderr).toContain(short(codeCommit));
  });

  it('refuses a multi-ref push when only one of its refs is receipted', () => {
    writeReceipts({ [docsCommit]: clean() });

    const run = runCheck(
      refLine(docsCommit, baseCommit, 'refs/heads/a') + refLine(codeCommit, baseCommit, 'refs/heads/b'),
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(short(codeCommit));
    expect(run.stderr).not.toContain(short(docsCommit));
  });

  it('gates HEAD when run manually with no piped ref lines', () => {
    // Blank input is a manual invocation, NOT an empty push: treating it as
    // "nothing to gate" would let an unreceipted manual check report OK.
    const run = runCheck('');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(short(docsCommit)); // HEAD of the probe repo
  });

  it('refuses when the ref lines cannot be read at all', () => {
    // A failed read is not the same absence as no input. Handing the child a
    // directory as fd 0 makes readFileSync(0) throw, which is the only way to
    // reach this branch without patching the module under test.
    const directoryFd = openSync(repo, 'r');
    try {
      const run = runCheck(directoryFd);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('cannot read the pushed ref lines');
    } finally {
      closeSync(directoryFd);
    }
  });

  it('refuses an unparseable ref line rather than gating blind', () => {
    const run = runCheck('not a ref line\n');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unparseable ref line');
  });

  it.each([39, 41, 63, 65])('refuses a LOCAL sha of the wrong width (%i)', (width) => {
    const run = runCheck(refLine('a'.repeat(width), ZERO));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unparseable ref line');
  });

  it.each([39, 41, 63, 65])('refuses a REMOTE sha of the wrong width (%i)', (width) => {
    // Dropping remote-sha validation would let a receipted local commit through
    // on a malformed line — an input the gate refused before this branch.
    writeReceipts({ [docsCommit]: clean() });

    const run = runCheck(refLine(docsCommit, 'a'.repeat(width)));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unparseable ref line');
  });

  it('allows a deletion-only push, which introduces nothing to review', () => {
    const run = runCheck(refLine(ZERO, docsCommit));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('deletion-only push');
  });

  it('peels an annotated tag to the commit receipts are keyed on', () => {
    // The tag targets a commit that is NOT HEAD, so a broken path falling back
    // to gating HEAD would name the wrong sha and fail here.
    expect(tagObject).not.toBe(codeCommit);

    const run = runCheck(refLine(tagObject, ZERO, 'refs/tags/probe-tag'));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(short(codeCommit));
    expect(run.stderr).not.toContain(short(tagObject));
    expect(run.stderr).not.toContain(short(docsCommit)); // HEAD, the fallback
  });

  it('allows a push of an annotated tag once its commit is receipted', () => {
    writeReceipts({ [codeCommit]: clean() });

    const run = runCheck(refLine(tagObject, ZERO, 'refs/tags/probe-tag'));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('review receipts OK');
  });
});
