import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
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
const LAYERS = ['ce-code-review', 'cross-model-peer'] as const;

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

// Nearly every test here spawns a node or git child; process start-up on a
// loaded machine can alone exceed jest's 5s default, so the whole file gets a
// generous budget — a deliberate granularity trade (per-test annotation on
// nearly every test is noise) at the cost of slower worst-case hang detection.
jest.setTimeout(30_000);

// Children get a scrubbed env: inherited GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE
// (e.g. under a git hook) would silently retarget the temp-repo git calls at
// the real repository.
const childEnv = { ...process.env };
delete childEnv.GIT_DIR;
delete childEnv.GIT_WORK_TREE;
delete childEnv.GIT_INDEX_FILE;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: childEnv }).trim();
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

/** The receipt store as written on disk — the only proof a write did NOT happen. */
function storedReceipts(): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8')).receipts;
}

const clean = (): Record<string, string> =>
  Object.fromEntries(LAYERS.map((layer) => [layer, '2026-07-29T00:00:00.000Z']));

/** `stdin` as text, or a raw descriptor when the point is how the read behaves. */
function runScript(
  args: string[],
  stdin: string | number = '',
  extraEnv: Record<string, string> = {},
): Run {
  const env = { ...childEnv, ...extraEnv };
  const options =
    typeof stdin === 'number'
      ? { cwd: repo, encoding: 'utf8' as const, stdio: [stdin, 'pipe', 'pipe'] as const, env }
      : { cwd: repo, input: stdin, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const, env };
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], options);
    return { status: 0, stdout: stdout ?? '', stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

const runCheck = (stdin: string | number): Run => runScript(['check'], stdin);
/**
 * Record `layer`, attesting for the peer layer the way its wrapper does — the
 * peer receipt is deliberately unreachable without that attestation.
 */
const runRecord = (layer: string, sha?: string): Run => {
  const target = sha ?? git(['rev-parse', 'HEAD']);
  const attest = layer === 'cross-model-peer' ? { OG_PEER_REVIEW_ATTESTED_SHA: target } : {};
  return runScript(sha ? ['record', layer, sha] : ['record', layer], '', attest);
};

const refLine = (local: string, remote: string, ref = 'refs/heads/probe'): string =>
  `${ref} ${local} ${ref} ${remote}\n`;

const short = (sha: string): string => sha.slice(0, 7);

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'receipts-gate-'));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'probe@example.invalid']);
  git(['config', 'user.name', 'Probe']);
  git(['config', 'commit.gpgsign', 'false']);
  // Tag signing too: a machine with `tag.gpgSign` on would prompt or fail here,
  // which would make a suite that calls itself hermetic depend on the machine.
  git(['config', 'tag.gpgSign', 'false']);
  baseCommit = commitFile('README.md', 'base\n', 'base');
  codeCommit = commitFile('src/thing.ts', 'export const a = 1;\n', 'code');
  docsCommit = commitFile('docs/note.md', 'prose\n', 'docs');
  // Tagged in setup, not in a test, so no case depends on another having run.
  git(['tag', '-a', '-m', 'probe', 'probe-tag', codeCommit]);
  tagObject = git(['rev-parse', 'refs/tags/probe-tag']);
}, 30_000);

afterAll(() => {
  // Retries: freshly-written git objects are prime AV-handle-holding targets
  // on a loaded Windows machine, and a retry-less rm throws EBUSY.
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

  // A failed read is not the same absence as no input. Handing the child a
  // directory as fd 0 makes readFileSync(0) throw, which reaches that branch
  // without patching the module under test — but whether a directory can be
  // opened as a descriptor at all varies by platform and runtime version. The
  // probe runs once here so an environment that refuses skips the case instead
  // of failing it: the branch fails closed either way, and a red build over an
  // unbuildable fixture would say nothing about the gate.
  const canOpenDirectoryAsFd = ((): boolean => {
    try {
      closeSync(openSync(tmpdir(), 'r'));
      return true;
    } catch {
      return false;
    }
  })();

  (canOpenDirectoryAsFd ? it : it.skip)('refuses when the ref lines cannot be read at all', () => {
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

  it('refuses a line with the right shas but the wrong token count', () => {
    // Both other malformed cases carry exactly four tokens and fail on their sha
    // fields, so dropping the count check would admit this line unnoticed.
    const run = runCheck(`refs/heads/probe ${docsCommit} refs/heads/probe ${baseCommit} extra\n`);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unparseable ref line');
  });

  it('refuses a pushed object that cannot be peeled to a commit', () => {
    // A tag pointing at a blob has no commit to key receipts on. Skipping it
    // would let its ref through ungated, so the gate must refuse instead.
    const blob = git(['rev-parse', `${docsCommit}:docs/note.md`]);
    git(['tag', '-a', '-m', 'blobby', 'blob-tag', blob]);
    const blobTag = git(['rev-parse', 'refs/tags/blob-tag']);
    try {
      const run = runCheck(refLine(blobTag, ZERO, 'refs/tags/blob-tag'));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('cannot resolve a pushed object to a commit');
    } finally {
      git(['tag', '-d', 'blob-tag']);
    }
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

  it('records both model-neutral layers for HEAD', () => {
    for (const layer of LAYERS) {
      const record = runRecord(layer);
      expect(record.status).toBe(0);
      expect(record.stdout).toContain(`recorded clean ${layer} receipt`);
    }

    expect(runCheck('').status).toBe(0);
  });

  it('records against an explicitly named commit, not whatever HEAD became', () => {
    // A long review outlives its subject: the reviewer finishes, another
    // commit lands, and re-reading HEAD would stamp the clean verdict onto
    // work nobody read. The reviewed sha is passed in for exactly that reason.
    const reviewed = git(['rev-parse', 'HEAD']);
    const moved = commitFile('drift.md', 'landed while the review ran\n', 'drift');
    expect(moved).not.toBe(reviewed);

    for (const layer of LAYERS) {
      const record = runRecord(layer, reviewed);
      expect(record.status).toBe(0);
      expect(record.stdout).toContain(`recorded clean ${layer} receipt for ${reviewed.slice(0, 7)}`);
    }

    // The receipt covers the reviewed commit, and the one that landed after it
    // is still ungated.
    expect(runCheck(refLine(reviewed, ZERO, 'refs/heads/main')).status).toBe(0);
    expect(runCheck(refLine(moved, ZERO, 'refs/heads/main')).status).toBe(1);
  });

  it('refuses a hand-stamped peer receipt, and points at the wrapper instead', () => {
    // The layer exists to prove an independent review ran. While `record
    // cross-model-peer` was a bare command — printed by the refusal message as
    // the fix — five PRs were receipted with no peer review at all.
    const sha = git(['rev-parse', 'HEAD']);
    // Layer one recorded FIRST, so the peer receipt is the only thing standing
    // between this commit and a passing gate. Without that, neither layer is
    // present and "no peer receipt" holds no matter what the command did —
    // the assertion would pass on a write-before-validation regression.
    expect(runRecord('ce-code-review', sha).status).toBe(0);

    const run = runScript(['record', 'cross-model-peer', sha]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('recorded BY the review');
    expect(run.stderr).toContain('cross-model-peer-review.sh');
    expect(storedReceipts()[sha]?.['cross-model-peer']).toBeUndefined();
    // And the gate still refuses the push, naming the layer it is missing.
    const gate = runCheck(refLine(sha, ZERO, 'refs/heads/main'));
    expect(gate.status).toBe(1);
    expect(gate.stderr).toContain('cross-model-peer');
  });

  it('accepts the peer receipt when the wrapper attests the reviewed sha', () => {
    // The other half: a gate nothing can pass gets routed around. This one HAS
    // to admit a real review — that failure mode has already cost a day.
    const sha = git(['rev-parse', 'HEAD']);

    const run = runScript(['record', 'cross-model-peer', sha], '', {
      OG_PEER_REVIEW_ATTESTED_SHA: sha,
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('recorded clean cross-model-peer receipt');
  });

  it('refuses an attestation that names a different commit than the one being recorded', () => {
    // The attestation has to match the SUBJECT, not merely exist. A review of
    // an earlier commit leaves its sha exported in the shell; the next commit
    // would then inherit a receipt for a review that never saw it. Nothing
    // else in this file distinguishes "attested" from "attested for THIS
    // commit" — weaken the comparison to a presence check and every other
    // test here still passes.
    const reviewed = git(['rev-parse', 'HEAD']);
    const unreviewed = commitFile('later.md', 'landed after the peer review\n', 'later');
    expect(unreviewed).not.toBe(reviewed);

    const run = runScript(['record', 'cross-model-peer', unreviewed], '', {
      OG_PEER_REVIEW_ATTESTED_SHA: reviewed,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('recorded BY the review');
    expect(storedReceipts()[unreviewed]?.['cross-model-peer']).toBeUndefined();
  });

  it('refuses a sha that is not a full object name', () => {
    const short = git(['rev-parse', '--short', 'HEAD']);

    const run = runScript(['record', 'cross-model-peer', short]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('invalid commit sha');
  });

  it('rejects the retired model-specific layer name', () => {
    expect(runRecord('ce-code-review').status).toBe(0);

    const retired = runRecord('codex-local');
    const check = runCheck('');

    expect(retired.status).toBe(1);
    expect(retired.stderr).toContain('unknown review layer "codex-local"');
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('cross-model-peer');
  });
});
