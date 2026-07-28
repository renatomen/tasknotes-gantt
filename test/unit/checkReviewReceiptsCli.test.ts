import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
const LAYERS = ['ce-code-review', 'codex-local'];

let repo: string;
let docsCommit: string;
let codeCommit: string;
let baseCommit: string;

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

function runCheck(stdin: string): Run {
  try {
    const stdout = execFileSync('node', [SCRIPT, 'check'], {
      cwd: repo,
      input: stdin,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
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
    // With the exemption installed this case passes; that is what it is here for.
    expect(git(['diff', '--name-only', codeCommit, docsCommit])).toBe('docs/note.md');

    const run = runCheck(refLine(docsCommit, codeCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(short(docsCommit));
  });

  it('refuses when only one of the two layers has been recorded', () => {
    writeReceipts({ [docsCommit]: { [LAYERS[0]!]: '2026-07-29T00:00:00.000Z' } });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(LAYERS[1]!);
    expect(run.stderr).not.toContain(`${LAYERS[0]!},`);
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

  it('refuses an unparseable ref line rather than gating blind', () => {
    const run = runCheck('not a ref line\n');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing to gate blind');
  });

  it.each([39, 41, 63, 65])('refuses a hex sha of the wrong width (%i)', (width) => {
    const run = runCheck(refLine('a'.repeat(width), ZERO));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing to gate blind');
  });

  it('allows a deletion-only push, which introduces nothing to review', () => {
    const run = runCheck(refLine(ZERO, docsCommit));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('deletion-only push');
  });

  it('peels an annotated tag to the commit receipts are keyed on', () => {
    // The tag targets a commit that is NOT HEAD, so a broken path that fell back
    // to gating HEAD would name the wrong sha and fail here.
    git(['tag', '-a', '-m', 'probe', 'probe-tag', codeCommit]);
    const tagObject = git(['rev-parse', 'refs/tags/probe-tag']);
    expect(tagObject).not.toBe(codeCommit);

    const run = runCheck(refLine(tagObject, ZERO, 'refs/tags/probe-tag'));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(short(codeCommit));
    expect(run.stderr).not.toContain(short(tagObject));
    expect(run.stderr).not.toContain(short(git(['rev-parse', 'HEAD'])));
  });

  it('allows a push of an annotated tag once its commit is receipted', () => {
    writeReceipts({ [codeCommit]: clean() });
    const tagObject = git(['rev-parse', 'refs/tags/probe-tag']);

    const run = runCheck(refLine(tagObject, ZERO, 'refs/tags/probe-tag'));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('review receipts OK');
  });
});
