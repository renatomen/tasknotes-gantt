import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, openSync, closeSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
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
delete childEnv.OG_PEER_REVIEW_ATTESTED_SHA;
delete childEnv.OG_PEER_REVIEW_ATTESTED_FAMILY;
delete childEnv.OG_PEER_REVIEW_ATTESTED_AUTHORS;

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

interface ReviewEntry {
  at: string;
  findings?: string;
  family?: string;
  authors?: string[];
}

type ReceiptLayers = Record<string, string | ReviewEntry>;
/** Put a controlled receipt store in place; `{}` means nothing is receipted. */
function writeReceipts(receipts: Record<string, ReceiptLayers>): void {
  writeFileSync(join(repo, '.git', 'review-receipts.json'), JSON.stringify({ receipts }, null, 2));
}

/** The receipt store as written on disk — the only proof a write did NOT happen. */
function storedReceipts(): Record<string, ReceiptLayers> {
  return JSON.parse(readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8')).receipts;
}

const clean = (): Record<string, string> =>
  Object.fromEntries(LAYERS.map((layer) => [layer, '2026-07-29T00:00:00.000Z']));

/** `stdin` as text, or a raw descriptor when the point is how the read behaves. */
function runScript(
  args: string[],
  stdin: string | number = '',
  extraEnv: Record<string, string> = {},
  cwd = repo,
): Run {
  const env = { ...childEnv, ...extraEnv };
  const options =
    typeof stdin === 'number'
      ? { cwd, encoding: 'utf8' as const, stdio: [stdin, 'pipe', 'pipe'] as Array<number | 'pipe'>, env }
      : { cwd, input: stdin, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as Array<number | 'pipe'>, env };
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
  const attest: Record<string, string> =
    layer === 'cross-model-peer' ? { OG_PEER_REVIEW_ATTESTED_SHA: target, OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex', OG_PEER_REVIEW_ATTESTED_AUTHORS: '["claude"]' } : {};
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

  describe('archival review-subject refs', () => {
    const subjectRef = (sha: string): string => `refs/e11-subjects/${sha}`;

    it('accepts a pin named by the full sha of the pushed commit, without receipts, and says so', () => {
      const run = runCheck(refLine(codeCommit, ZERO, subjectRef(codeCommit)));

      expect(run.status).toBe(0);
      expect(run.stdout).toContain(`archival review subjects accepted without receipts (refs/e11-subjects/*): ${codeCommit}`);
      expect(run.stdout).not.toContain('deletion-only push');
    });

    it('refuses a pin named by an abbreviation of the pushed commit', () => {
      const run = runCheck(refLine(codeCommit, ZERO, subjectRef(short(codeCommit))));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('archival');
      expect(run.stderr).toContain('full object id');
    });

    it('refuses a pin named by a different commit than the one pushed', () => {
      // The prefix alone must not be the exemption: an archived object that is
      // not the named subject leaves the recorded review range unrebuildable.
      const run = runCheck(refLine(docsCommit, ZERO, subjectRef(codeCommit)));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('archival');
      expect(run.stderr).toContain(short(codeCommit));
    });

    it('refuses an annotated tag object even when it points at the subject commit', () => {
      git(['tag', '-a', '-m', 'subject-tag', 'subject-commit-tag', codeCommit]);
      const tagObject = git(['rev-parse', 'refs/tags/subject-commit-tag']);
      try {
        const run = runCheck(refLine(tagObject, ZERO, subjectRef(codeCommit)));

        expect(run.status).toBe(1);
        expect(run.stderr).toContain('not a commit');
      } finally {
        git(['tag', '-d', 'subject-commit-tag']);
      }
    });

    it('refuses a blob object pushed under its own id', () => {
      const blob = git(['rev-parse', `${docsCommit}:docs/note.md`]);

      const run = runCheck(refLine(blob, ZERO, subjectRef(blob)));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('is a blob, not a commit');
    });

    it('refuses a pin whose name carries a non-ASCII whitespace byte after the id', () => {
      // git would create that ref; the gate must not read the name as the bare id.
      const run = runCheck(refLine(codeCommit, ZERO, `${subjectRef(codeCommit)}\u00a0`));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('full object id');
    });

    it('refuses updating a subject ref that already exists on the remote: pins are write-once', () => {
      const run = runCheck(refLine(codeCommit, docsCommit, subjectRef(codeCommit)));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('archival');
      expect(run.stderr).toContain('write-once');
    });

    it('refuses deleting a subject ref: the corpus rebuilds its ranges from it', () => {
      const run = runCheck(refLine(ZERO, codeCommit, subjectRef(codeCommit)));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('archival');
      expect(run.stderr).toContain('delet');
    });

    it('still gates a branch pushed alongside a subject ref', () => {
      const run = runCheck(refLine(codeCommit, ZERO, subjectRef(codeCommit)) + refLine(docsCommit, baseCommit, 'refs/heads/a'));

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(short(docsCommit));
    });
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
      OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex',
      OG_PEER_REVIEW_ATTESTED_AUTHORS: '["claude"]',
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
      OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex',
      OG_PEER_REVIEW_ATTESTED_AUTHORS: '["claude"]',
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('recorded BY the review');
    expect(storedReceipts()[unreviewed]?.['cross-model-peer']).toBeUndefined();
  });

  describe('acknowledged findings', () => {
    // A reviewer whose job is to find things will find something, so a gate that
    // stamps only on a clean verdict is a gate no change can pass — and an
    // unpassable gate gets bypassed with --no-verify, which is worse than the
    // honour system this one replaced. The third state keeps the review
    // mandatory while letting the maintainer accept what it found.
    const DIGEST = 'a'.repeat(64);

    it('records a receipt for findings the reviewer actually produced', () => {
      const sha = git(['rev-parse', 'HEAD']);

      const run = runScript(['record', 'cross-model-peer', sha, '--acknowledged', DIGEST], '', {
        OG_PEER_REVIEW_ATTESTED_SHA: sha,
        OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex',
        OG_PEER_REVIEW_ATTESTED_AUTHORS: '["claude"]',
      });

      expect(run.status).toBe(0);
      expect(run.stdout).toContain('acknowledged');
      expect(storedReceipts()[sha]?.['cross-model-peer']).toBeDefined();
    });

    it('still refuses an acknowledgement the wrapper did not attest', () => {
      // The third state must not become the hand-stamp door reopened.
      const sha = git(['rev-parse', 'HEAD']);
      expect(runRecord('ce-code-review', sha).status).toBe(0);

      const run = runScript(['record', 'cross-model-peer', sha, '--acknowledged', DIGEST]);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('recorded BY the review');
      expect(storedReceipts()[sha]?.['cross-model-peer']).toBeUndefined();
    });

    it('refuses an EMPTY acknowledgement rather than silently calling it clean', () => {
      // `?? 'missing'` does not catch an empty string, so `--acknowledged ""`
      // fell through to the clean-receipt branch: a review that found things,
      // stored as one that found none. The wrapper could produce exactly that
      // empty value whenever its digest step failed.
      const sha = git(['rev-parse', 'HEAD']);

      const run = runScript(['record', 'cross-model-peer', sha, '--acknowledged', ''], '', {
        OG_PEER_REVIEW_ATTESTED_SHA: sha,
        OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex',
        OG_PEER_REVIEW_ATTESTED_AUTHORS: '["claude"]',
      });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('review digest');
      expect(storedReceipts()[sha]?.['cross-model-peer']).toBeUndefined();
    });

    it('refuses an acknowledgement that names no review text', () => {
      // The digest is what binds the acknowledgement to a review that ran;
      // without it this is just a clean receipt wearing a different word.
      const sha = git(['rev-parse', 'HEAD']);

      const run = runScript(['record', 'cross-model-peer', sha, '--acknowledged', 'not-a-digest'], '', {
        OG_PEER_REVIEW_ATTESTED_SHA: sha,
        OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex',
        OG_PEER_REVIEW_ATTESTED_AUTHORS: '["claude"]',
      });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('review digest');
      expect(storedReceipts()[sha]?.['cross-model-peer']).toBeUndefined();
    });

    it('names the accepted findings on every push, so they cannot be forgotten', () => {
      const sha = git(['rev-parse', 'HEAD']);
      expect(runRecord('ce-code-review', sha).status).toBe(0);
      expect(
        runScript(['record', 'cross-model-peer', sha, '--acknowledged', DIGEST], '', {
          OG_PEER_REVIEW_ATTESTED_SHA: sha,
          OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex',
          OG_PEER_REVIEW_ATTESTED_AUTHORS: '["claude"]',
        }).status,
      ).toBe(0);

      const gate = runCheck(refLine(sha, ZERO, 'refs/heads/main'));

      expect(gate.status).toBe(0);
      expect(gate.stdout + gate.stderr).toContain(DIGEST.slice(0, 12));
      expect(gate.stdout + gate.stderr).toContain('accepted findings');
    });
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

describe('peer receipt independence', () => {
  it('checks legacy receipts without requiring current commit declarations', () => {
    writeReceipts({ [docsCommit]: clean() });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('review receipts OK');
  });

  it.each([['claude', 'codex', 0], ['codex', 'codex', 1], ['codex', 'claude', 0]])(
    'checks recorded %s authorship with a %s peer', (author, family, status) => {
      writeReceipts({ [docsCommit]: { ...clean(), 'cross-model-peer': { at: 'now', family, authors: [author] } } });

      const run = runCheck(refLine(docsCommit, baseCommit));

      expect(run.status).toBe(status);
      if (status === 1) expect(run.stderr).toContain('--peer claude');
    },
  );

  it.each(['codex', 'claude'])('refuses a receipt attesting both-family authorship with a %s peer', (family) => {
    writeReceipts({ [docsCommit]: { ...clean(), 'cross-model-peer': { at: 'now', family, authors: ['codex', 'claude'] } } });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('no eligible peer');
  });

  it('refuses a new peer receipt without a recorded author set', () => {
    writeReceipts({ [docsCommit]: { ...clean(), 'cross-model-peer': { at: 'now', family: 'codex' } } });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('author set');
  });

  it('refuses a new peer receipt without its reviewing family', () => {
    writeReceipts({ [docsCommit]: { ...clean(), 'cross-model-peer': { at: 'now', authors: ['codex'] } } });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('invalid peer family');
  });

  it.each(['2026-07-29T00:00:00.000Z', { at: 'now', findings: 'a'.repeat(64) }])('treats a legacy peer as Codex reviewing Claude authors (%j)', (peer) => {
    writeReceipts({ [docsCommit]: { ...clean(), 'cross-model-peer': peer } });

    const run = runCheck(refLine(docsCommit, baseCommit));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('review receipts OK');
  });

  it('uses the receipt once when two pushed branches share a commit', () => {
    writeReceipts({ [docsCommit]: clean() });
    const input = refLine(docsCommit, baseCommit, 'refs/heads/a') +
      'refs/heads/b ' + docsCommit + ' refs/heads/destination ' + baseCommit + '\n';

    const run = runCheck(input);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('review receipts OK');
  });

  it.each([0, 1])('gives the same verdict %s to branch, non-HEAD tag and raw-SHA pushes', (status) => {
    const family = status === 0 ? 'claude' : 'codex';
    writeReceipts({ [codeCommit]: { ...clean(), 'cross-model-peer': { at: 'now', family, authors: ['codex'] } } });
    expect(git(['rev-parse', 'HEAD'])).not.toBe(codeCommit);
    const inputs = [
      refLine(codeCommit, ZERO, 'refs/heads/topic'),
      refLine(tagObject, ZERO, 'refs/tags/probe-tag'),
      `${codeCommit} ${codeCommit} refs/heads/topic ${ZERO}\n`,
    ];

    const runs = inputs.map(runCheck);

    expect(runs.map((run) => run.status)).toEqual([status, status, status]);
    for (const run of runs) {
      if (status === 1) expect(run.stderr).toContain('--peer claude');
      else expect(run.stdout).toContain('review receipts OK');
    }
  });

  it('checks manual HEAD and pushed tags without looking up a current branch', () => {
    writeReceipts({ [git(['rev-parse', 'HEAD'])]: clean(), [codeCommit]: clean() });
    git(['checkout', '-q', '--detach']);
    try {
      expect(runCheck('').status).toBe(0);
      expect(runCheck(refLine(tagObject, ZERO, 'refs/tags/probe-tag')).status).toBe(0);
    } finally {
      git(['checkout', '-q', 'main']);
    }
  });

  it('refuses a family without the wrapper SHA attestation', () => {
    const sha = git(['rev-parse', 'HEAD']);

    const run = runScript(['record', 'cross-model-peer', sha], '', { OG_PEER_REVIEW_ATTESTED_FAMILY: 'claude' });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('recorded BY the review');
    expect(storedReceipts()[sha]?.['cross-model-peer']).toBeUndefined();
  });

  it.each([undefined, 'gpt'])('refuses missing or unsupported attested family %s', (family) => {
    const sha = git(['rev-parse', 'HEAD']);
    const env: Record<string, string> = { OG_PEER_REVIEW_ATTESTED_SHA: sha };
    if (family) env.OG_PEER_REVIEW_ATTESTED_FAMILY = family;

    const run = runScript(['record', 'cross-model-peer', sha], '', env);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('family');
    expect(storedReceipts()[sha]?.['cross-model-peer']).toBeUndefined();
  });

  it.each(['codex', 'claude'])('records the attested %s family on a clean peer receipt', (family) => {
    const sha = git(['rev-parse', 'HEAD']);

    const run = runScript(['record', 'cross-model-peer', sha], '', {
      OG_PEER_REVIEW_ATTESTED_SHA: sha, OG_PEER_REVIEW_ATTESTED_FAMILY: family,
      OG_PEER_REVIEW_ATTESTED_AUTHORS: JSON.stringify([family === 'codex' ? 'claude' : 'codex']),
    });

    expect(run.status).toBe(0);
    expect(storedReceipts()[sha]?.['cross-model-peer']).toEqual({ at: expect.any(String), family, authors: [family === 'codex' ? 'claude' : 'codex'] });
  });

  it.each([undefined, '', 'not-json', '[]', '["gpt"]', '"claude"'])('refuses a missing or unusable attested author set %s', (authors) => {
    const sha = git(['rev-parse', 'HEAD']);
    const env: Record<string, string> = { OG_PEER_REVIEW_ATTESTED_SHA: sha, OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex' };
    if (authors !== undefined) env.OG_PEER_REVIEW_ATTESTED_AUTHORS = authors;
    const before = readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8');

    const run = runScript(['record', 'cross-model-peer', sha], '', env);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('author set');
    expect(readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8')).toBe(before);
  });

  it.each([
    ['["codex"]', '--peer claude'],
    ['["codex","claude"]', "each family's work must land on its own branch"],
  ])('refuses to record a family inside the attested author set %s', (authors, guidance) => {
    const sha = git(['rev-parse', 'HEAD']);
    const before = readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8');

    const run = runScript(['record', 'cross-model-peer', sha], '', {
      OG_PEER_REVIEW_ATTESTED_SHA: sha, OG_PEER_REVIEW_ATTESTED_FAMILY: 'codex', OG_PEER_REVIEW_ATTESTED_AUTHORS: authors,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(guidance);
    expect(readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8')).toBe(before);
  });
});


describe('per-commit author declarations', () => {
  let primaryRepo: string;
  let fixtureRoot: string;
  let topicBase: string;
  let first: string;
  let second: string;

  const authorPath = (cwd = repo): string => join(resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd)), 'review-authors.json');
  const authors = (cwd = repo): Record<string, string[]> => JSON.parse(readFileSync(authorPath(cwd), 'utf8')).authors;
  const writeAuthors = (entries: Record<string, string[]>): void => writeFileSync(authorPath(), JSON.stringify({ authors: entries }));
  const peerAuthors = (family: string, base = topicBase, tip = git(['rev-parse', 'HEAD']), cwd = repo): Run =>
    runScript(['peer-authors', family, base, tip], '', {}, cwd);
  const mutations = [
    { command: 'author', args: ['author', 'claude'], input: '' },
    { command: 'post-rewrite', args: ['post-rewrite'], input: () => `${first} ${second}\n` },
  ];

  function installFsProbe(body: string): Record<string, string> {
    const probe = join(fixtureRoot, 'author-store-probe.cjs');
    writeFileSync(probe, `
      const fs = require('node:fs');
      const { resolve, dirname } = require('node:path');
      const { syncBuiltinESMExports } = require('node:module');
      const storePath = ${JSON.stringify(authorPath())};
      ${body}
      syncBuiltinESMExports();
    `);
    return { NODE_OPTIONS: `--require "${probe.replaceAll('\\', '/')}"` };
  }

  async function waitForFile(path: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!existsSync(path)) {
      if (Date.now() >= deadline) throw new Error('declaration did not attempt to acquire the lock');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function installRewriteHook(): void {
    mkdirSync(join(repo, '.husky'), { recursive: true });
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    const hook = join(repo, '.husky', 'post-rewrite');
    writeFileSync(hook, readFileSync(resolve('.husky/post-rewrite')));
    chmodSync(hook, 0o755);
    writeFileSync(join(repo, 'scripts', 'check-review-receipts.mjs'), readFileSync(SCRIPT));
    git(['config', 'core.hooksPath', '.husky']);
  }

  function advanceDefault(): void {
    git(['checkout', '-q', 'main']);
    const newer = commitFile('main-only.md', 'reviewed on main\n', 'advance main');
    git(['update-ref', 'refs/remotes/origin/trunk', newer]);
    git(['checkout', '-q', 'topic']);
  }

  beforeEach(() => {
    primaryRepo = repo;
    fixtureRoot = mkdtempSync(join(tmpdir(), 'commit-authors-'));
    repo = join(fixtureRoot, 'repo');
    mkdirSync(repo);
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'probe@example.invalid']);
    git(['config', 'user.name', 'Probe']);
    git(['config', 'commit.gpgsign', 'false']);
    topicBase = commitFile('README.md', 'base\n', 'base');
    git(['update-ref', 'refs/remotes/origin/trunk', topicBase]);
    git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    git(['checkout', '-q', '-b', 'topic']);
    first = commitFile('one.md', 'one\n', 'first');
    second = commitFile('two.md', 'two\n', 'second');
    writeReceipts({ [second]: clean() });
  });

  afterEach(() => {
    repo = primaryRepo;
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('rejects unsupported authors without writing either store', () => {
    const before = readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8');

    const run = runScript(['author', 'gpt']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('codex');
    expect(run.stderr).toContain('claude');
    expect(readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8')).toBe(before);
    expect(readdirSync(join(repo, '.git'))).not.toContain('review-authors.json');
  });

  it('declares both undeclared commits and adds families to existing declarations', () => {
    expect(runScript(['author', 'codex']).status).toBe(0);
    expect(authors()).toEqual({ [first]: ['codex'], [second]: ['codex'] });
    const third = commitFile('three.md', 'three\n', 'third');

    expect(runScript(['author', 'claude']).status).toBe(0);
    expect(runScript(['author', 'claude']).status).toBe(0);

    expect(authors()).toEqual({ [first]: ['codex', 'claude'], [second]: ['codex', 'claude'], [third]: ['claude'] });
    for (const family of ['codex', 'claude']) {
      const run = peerAuthors(family);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('no eligible peer');
    }
  });

  it.each(mutations)('refuses $command when another writer holds the lock without changing the store', ({ args, input }) => {
    writeAuthors({ [first]: ['codex'], [second]: ['claude'] });
    const before = readFileSync(authorPath(), 'utf8');
    const lockPath = authorPath() + '.lock';
    const lock = openSync(lockPath, 'wx');
    try {
      const run = runScript(args, typeof input === 'function' ? input() : input);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('lock');
      expect(readFileSync(authorPath(), 'utf8')).toBe(before);
      expect(existsSync(lockPath)).toBe(true);
      expect(readdirSync(join(repo, '.git')).filter((name) => name.startsWith('review-authors.json.'))).toEqual(['review-authors.json.lock']);
    } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  });

  it.each(mutations)('releases the lock after a successful $command', ({ args, input }) => {
    writeAuthors({ [first]: ['codex'], [second]: ['claude'] });

    const run = runScript(args, typeof input === 'function' ? input() : input);

    expect(run.status).toBe(0);
    const lockPath = authorPath() + '.lock';
    const lock = openSync(lockPath, 'wx');
    closeSync(lock);
    unlinkSync(lockPath);
  });

  it('releases the lock when reading the author store fails', () => {
    writeFileSync(authorPath(), '{invalid json');

    const run = runScript(['author', 'codex']);

    expect(run.status).toBe(1);
    expect(readFileSync(authorPath(), 'utf8')).toBe('{invalid json');
    expect(existsSync(authorPath() + '.lock')).toBe(false);
  });

  it.each(['write', 'rename'])('preserves the complete store when an atomic %s fails', (stage) => {
    writeAuthors({ [first]: ['codex'], [second]: ['codex'] });
    const before = readFileSync(authorPath(), 'utf8');
    const env = installFsProbe(`
      const write = fs.writeFileSync;
      fs.writeFileSync = (path, data, ...options) => {
        if (typeof path === 'string' && resolve(path).startsWith(storePath) && '${stage}' === 'write') {
          write(path, String(data).slice(0, 12), ...options);
          throw new Error('interrupted author store write');
        }
        return write(path, data, ...options);
      };
      const rename = fs.renameSync;
      fs.renameSync = (source, destination) => {
        if (resolve(destination) === storePath) {
          if (dirname(resolve(source)) !== dirname(storePath)) throw new Error('temporary file is not adjacent');
          throw new Error('interrupted author store rename');
        }
        return rename(source, destination);
      };
    `);

    const run = runScript(['author', 'claude'], '', env);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`interrupted author store ${stage}`);
    expect(readFileSync(authorPath(), 'utf8')).toBe(before);
    expect(readdirSync(join(repo, '.git')).filter((name) => name.startsWith('review-authors.json.'))).toEqual([]);
  });

  it('merges declarations published by a linked worktree before the waiting writer acquires the lock', async () => {
    const linked = join(fixtureRoot, 'linked');
    git(['worktree', 'add', '-q', '--detach', linked, second]);
    writeAuthors({ [first]: ['codex'], [second]: ['codex'] });
    const signal = join(fixtureRoot, 'lock-attempted');
    const env = installFsProbe(`
      const open = fs.openSync;
      fs.openSync = (path, flags, ...options) => {
        if (typeof path === 'string' && resolve(path) === storePath + '.lock' && flags === 'wx') {
          fs.writeFileSync(${JSON.stringify(signal)}, 'attempted');
        }
        return open(path, flags, ...options);
      };
    `);
    const lockPath = authorPath() + '.lock';
    const lock = openSync(lockPath, 'wx');
    const completion = new Promise<Run>((resolve) => {
      execFile('node', [SCRIPT, 'author', 'codex'], {
        cwd: linked, env: { ...childEnv, ...env }, encoding: 'utf8', timeout: 10_000,
      }, (error, stdout, stderr) => {
        resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
      });
    });
    try {
      await waitForFile(signal);
      writeAuthors({ [first]: ['codex', 'claude'], [second]: ['codex', 'claude'] });
    } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }

    const run = await completion;

    expect(run.status).toBe(0);
    expect(authors()).toEqual({ [first]: ['codex', 'claude'], [second]: ['codex', 'claude'] });
  });

  it.each(['rename', 'new branch'])('keeps declarations after %s at the same HEAD', (operation) => {
    expect(runScript(['author', 'codex']).status).toBe(0);
    const before = authors();
    if (operation === 'rename') git(['branch', '-m', 'renamed']);
    else git(['checkout', '-q', '-b', 'new-topic']);

    const run = peerAuthors('claude');

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(['codex']);
    expect(authors()).toEqual(before);
  });

  it('shares commit declarations between linked worktrees', () => {
    const linked = join(fixtureRoot, 'linked');
    git(['worktree', 'add', '-q', '--detach', linked, second]);
    expect(runScript(['author', 'codex'], '', {}, linked).status).toBe(0);

    const run = peerAuthors('claude');

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(['codex']);
    expect(authors(linked)).toEqual({ [first]: ['codex'], [second]: ['codex'] });
    expect(authorPath(linked)).toBe(authorPath());
    expect(readdirSync(resolve(linked, git(['rev-parse', '--git-dir'], linked)))).not.toContain('review-authors.json');
  });

  it('writes only review-authors.json in the git common directory', () => {
    const snapshot = (): Record<string, string> => Object.fromEntries(readdirSync(repo, { recursive: true })
      .map(String)
      .filter((path) => path.replaceAll('\\', '/') !== '.git/review-authors.json' && statSync(join(repo, path)).isFile())
      .map((path) => [path, readFileSync(join(repo, path)).toString('base64')]));
    const before = snapshot();

    const run = runScript(['author', 'codex']);

    expect(run.status).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(authors()).toEqual({ [first]: ['codex'], [second]: ['codex'] });
    expect(JSON.parse(readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8'))).toEqual({ receipts: { [second]: clean() } });
  });

  it('refuses an undeclared commit even when another commit in the range is declared', () => {
    writeAuthors({ [second]: ['codex'] });

    const run = peerAuthors('claude');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(first.slice(0, 7));
    expect(run.stderr).toContain('author <family>');
  });

  it('uses only declarations in the reviewed range', () => {
    writeAuthors({ [first]: ['claude'], [second]: ['codex'] });

    const run = peerAuthors('claude', first);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(['codex']);
  });

  it('keeps the old family through an amend and adds the family that amended it', () => {
    installRewriteHook();
    expect(runScript(['author', 'codex']).status).toBe(0);
    git(['commit', '-q', '--amend', '--no-verify', '-m', 'amended by another family']);
    const amended = git(['rev-parse', 'HEAD']);
    expect(amended).not.toBe(second);
    expect(authors()[amended]).toEqual(['codex']);

    expect(runScript(['author', 'claude']).status).toBe(0);

    expect(authors()[amended]).toEqual(['codex', 'claude']);
    for (const family of ['codex', 'claude']) {
      const run = peerAuthors(family);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('no eligible peer');
    }
  });

  it('keeps each declared family when two commits are rebased onto newer main', () => {
    installRewriteHook();
    writeAuthors({ [first]: ['claude'], [second]: ['codex'] });
    advanceDefault();

    git(['rebase', 'refs/remotes/origin/trunk']);

    const rewritten = git(['rev-list', '--reverse', 'refs/remotes/origin/trunk..HEAD']).split('\n');
    expect(rewritten).toHaveLength(2);
    expect(rewritten).not.toContain(first);
    expect(rewritten).not.toContain(second);
    expect(authors()[rewritten[0]]).toEqual(['claude']);
    expect(authors()[rewritten[1]]).toEqual(['codex']);
  });

  it('unions both old families when a rebase squashes their commits', () => {
    installRewriteHook();
    writeAuthors({ [first]: ['claude'], [second]: ['codex'] });
    advanceDefault();
    const editor = join(fixtureRoot, 'sequence-editor.cjs');
    writeFileSync(editor, "const fs = require('fs'); const p = process.argv[2]; const s = fs.readFileSync(p, 'utf8'); let n = 0; fs.writeFileSync(p, s.replace(/^pick /gm, () => ++n === 2 ? 'squash ' : 'pick '));");

    execFileSync('git', ['rebase', '-i', 'refs/remotes/origin/trunk'], {
      cwd: repo, encoding: 'utf8', env: { ...childEnv, GIT_SEQUENCE_EDITOR: 'node "' + editor.replaceAll('\\', '/') + '"', GIT_EDITOR: 'true' },
    });

    const rewritten = git(['rev-list', 'refs/remotes/origin/trunk..HEAD']).split('\n');
    expect(rewritten).toHaveLength(1);
    expect(authors()[rewritten[0]]).toEqual(['claude', 'codex']);
    for (const family of ['codex', 'claude']) {
      const run = peerAuthors(family);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('no eligible peer');
    }
  });
});
