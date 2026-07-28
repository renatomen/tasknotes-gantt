import { execFileSync } from 'node:child_process';

/**
 * The gate's contract, exercised through the real entry point.
 *
 * The pure exports are unit-tested elsewhere, but `check()` is where the
 * decisions actually bind: it reads git's stdin, peels tags, refuses malformed
 * input and calls `process.exit`. None of that is reachable from an import, so
 * without these the gate's refusal behaviour would be verified by hand once and
 * never again — which is how a gate quietly stops gating.
 */
const SCRIPT = 'scripts/check-review-receipts.mjs';
const ZERO = '0'.repeat(40);

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runCheck(stdin: string): Run {
  try {
    const stdout = execFileSync('node', [SCRIPT, 'check'], {
      input: stdin,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

const sha = (rev: string): string =>
  execFileSync('git', ['rev-parse', rev], { encoding: 'utf8' }).trim();

const refLine = (local: string, remote: string): string =>
  `refs/heads/probe ${local} refs/heads/probe ${remote}\n`;

describe('check-review-receipts check', () => {
  it('refuses a pushed commit that holds no receipts', () => {
    const run = runCheck(refLine(sha('HEAD'), ZERO));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('missing clean review receipts');
  });

  it('refuses an unparseable ref line rather than gating blind', () => {
    const run = runCheck('not a ref line\n');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing to gate blind');
  });

  it('refuses a ref line whose sha is not valid hex of sha1 or sha256 width', () => {
    const run = runCheck(refLine('g'.repeat(40), ZERO));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing to gate blind');
  });

  it('allows a deletion-only push, which introduces nothing to review', () => {
    const run = runCheck(refLine(ZERO, sha('HEAD')));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('deletion-only push');
  });

  it('gates every distinct pushed sha, not merely the first', () => {
    const run = runCheck(refLine(sha('HEAD'), ZERO) + refLine(sha('HEAD~1'), ZERO));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(sha('HEAD~1').slice(0, 7));
  });

  it('names both required layers when neither has been recorded', () => {
    const run = runCheck(refLine(sha('HEAD'), ZERO));

    expect(run.stderr).toContain('ce-code-review');
    expect(run.stderr).toContain('codex-local');
  });

  it('peels an annotated tag to the commit receipts are keyed on', () => {
    const commit = sha('HEAD');
    const tag = `refs/tags/receipts-probe-${process.pid}`;
    execFileSync('git', ['tag', '-a', '-m', 'probe', tag.replace('refs/tags/', ''), commit]);
    try {
      const tagObject = sha(tag);
      expect(tagObject).not.toBe(commit); // an annotated tag is its own object

      const run = runCheck(`${tag} ${tagObject} ${tag} ${ZERO}\n`);

      // The refusal must name the COMMIT, proving the tag object was peeled -
      // receipts are keyed on commits, so an unpeeled tag would never match one.
      expect(run.stderr).toContain(commit.slice(0, 7));
    } finally {
      execFileSync('git', ['tag', '-d', tag.replace('refs/tags/', '')]);
    }
  });
});
