import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

/**
 * The peer wrapper's guards, exercised against a stub reviewer.
 *
 * Twelve review rounds found defects in this script that no test could have
 * missed — the dirty check counting the script's own output, a fail-open
 * pipeline, an unanchored submodule match. Each cost a full model call to find,
 * because "run it and read the answer" was the only way to ask. A stub `codex`
 * on PATH asks the same questions in milliseconds.
 *
 * The stub is what makes the fail-closed paths reachable at all: a real
 * reviewer cannot be told to omit its sentinel, hedge after its verdict, or die
 * halfway, and those are exactly the paths that decide whether an unread change
 * can arrive looking clean.
 */
const WRAPPER = resolve('scripts/cross-model-peer-review.sh');

jest.setTimeout(60_000);

const childEnv = { ...process.env };
delete childEnv.GIT_DIR;
delete childEnv.GIT_WORK_TREE;
delete childEnv.GIT_INDEX_FILE;

let repo: string;
let origin: string;
let stubDir: string;
let promptFile: string;
let responseFile: string;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

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

/**
 * The stub answers from a template, substituting the per-run sentinel and
 * canary it recovers from the prompt — the wrapper mints both fresh each run,
 * so a fixed string could never satisfy the read-proof.
 */
function writeStub(): void {
  const stub = `#!/usr/bin/env bash
prompt="$*"
printf '%s' "$prompt" > "$PEER_STUB_PROMPT"
sentinel=$(head -1 "$PEER_STUB_REPO/.peer-review-diff.tmp" | sed 's/^SAW-DIFF: //')
printf '%s' "$sentinel" > "$PEER_STUB_PROMPT.sentinel"
canary=$(printf '%s' "$prompt" | grep -aoE 'PROMPT-ECHO-[0-9]+-[0-9a-f]+' | head -1)
if [ -n "\${PEER_STUB_SIDE_EFFECT:-}" ]; then eval "$PEER_STUB_SIDE_EFFECT"; fi
body=$(cat "$PEER_STUB_RESPONSE")
body=\${body//@@SENTINEL@@/$sentinel}
body=\${body//@@CANARY@@/$canary}
printf '%s\\n' "$body"
exit "\${PEER_STUB_EXIT:-0}"
`;
  const target = join(stubDir, 'codex');
  writeFileSync(target, stub);
  chmodSync(target, 0o755);
}

interface StubOpts {
  record?: boolean;
  acknowledge?: boolean;
  exit?: string;
  sideEffect?: string;
}

function runWrapper(response: string, opts: StubOpts = {}): Run {
  writeFileSync(responseFile, response);
  const args = [WRAPPER, 'origin/main', join(repo, '..', 'peer-out.md')];
  if (opts.record) args.push('--record');
  if (opts.acknowledge) args.push('--acknowledge');
  const result = execFileSync('bash', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...childEnv,
      PATH: `${stubDir}${delimiter}${childEnv.PATH ?? ''}`,
      PEER_STUB_PROMPT: promptFile,
      PEER_STUB_REPO: repo,
      PEER_STUB_RESPONSE: responseFile,
      PEER_STUB_EXIT: opts.exit ?? '0',
      PEER_STUB_SIDE_EFFECT: opts.sideEffect ?? '',
    },
    // The wrapper signals every refusal through its exit code, so a nonzero
    // status is the subject of most of these tests, not a failure of them.
    stdio: 'pipe',
  } as never);
  return { status: 0, stdout: String(result), stderr: '' };
}

/** The same call, for the paths that are supposed to refuse. */
function runExpectingRefusal(response: string, opts: StubOpts = {}): Run {
  try {
    const ok = runWrapper(response, opts);
    return { ...ok, status: 0 };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

function receipts(): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(readFileSync(join(repo, '.git', 'review-receipts.json'), 'utf8')).receipts;
  } catch {
    return {};
  }
}

const CLEAN = 'SAW-DIFF: @@SENTINEL@@\n\nNothing found.\n\nVERDICT: CLEAN';

/**
 * Runs one of the wrapper's own shell functions against the current repo.
 *
 * Three consecutive review rounds each found a real defect in `refresh_upstream`
 * and `default_base` — an inverted status, a base chosen from a local branch, a
 * ref fabricated in another remote's namespace — and every one was found by
 * reproduction after a hand trace of mine got it backwards. They resisted the
 * end-to-end tests because they decide what the review is ABOUT, before a
 * reviewer is ever invoked. Calling them directly is what makes them testable.
 */
function callWrapperFn(fn: string, cwd = repo): { status: number; stdout: string } {
  const source = readFileSync(resolve('scripts/cross-model-peer-review.sh'), 'utf8');
  const names = ['tracking_remote', 'base_ref', 'refresh_upstream', 'default_base'];
  const blocks = names
    .map((name) => {
      const start = source.indexOf(`${name}() {`);
      // A missing function would otherwise be silently absent from the extracted
      // script, and every caller would take its empty-ref path and pass — which
      // is exactly how adding base_ref made two of these tests fail for a reason
      // that had nothing to do with the code they cover.
      if (start === -1) throw new Error(`callWrapperFn: ${name}() not found in the wrapper`);
      return source.slice(start).split('\n}')[0] + '\n}';
    })
    .join('\n');
  const script = `set -u\ngit_nr() { git --no-replace-objects "$@"; }\n${blocks}\n${fn}\n`;
  try {
    const stdout = execFileSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: childEnv });
    return { status: 0, stdout: String(stdout) };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? -1, stdout: String(e.stdout ?? '') };
  }
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'peer-wrapper-'));
  repo = join(root, 'repo');
  origin = join(root, 'origin.git');
  stubDir = join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(stubDir);
  promptFile = join(root, 'prompt.txt');
  responseFile = join(root, 'response.txt');
  writeStub();

  execFileSync('git', ['init', '-q', '--bare', origin], { env: childEnv });
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  // The wrapper records through $REPO_ROOT/scripts/check-review-receipts.mjs,
  // so the real gate has to be present for the recording paths to be reachable.
  mkdirSync(join(repo, 'scripts'));
  writeFileSync(
    join(repo, 'scripts', 'check-review-receipts.mjs'),
    readFileSync(resolve('scripts/check-review-receipts.mjs'), 'utf8'),
  );
  commitFile('seed.txt', 'seed\n', 'seed');
  git(['add', 'scripts']);
  git(['commit', '-q', '--no-verify', '-m', 'gate']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', '-q', '--no-verify', '-u', 'origin', 'main']);
  // One reviewable commit on top of the pushed state.
  commitFile('feature.txt', 'a change to review\n', 'feature');
});

afterEach(() => {
  rmSync(join(repo, '..'), { recursive: true, force: true });
});

describe('cross-model peer review wrapper', () => {
  it('records a receipt when the reviewer echoes the sentinel and returns clean', () => {
    const run = runWrapper(CLEAN, { record: true });

    expect(run.stdout).toContain('VERDICT:CLEAN');
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeDefined();
  });

  it('does not count its own output files as a dirty worktree', () => {
    // The documented invocation writes $OUT and $OUT.stderr after the first
    // cleanliness check, so a guard that counted untracked files refused every
    // clean review it had just paid for. Untracked files the DEVELOPER left
    // behind are the same shape and equally harmless — the reviewer cannot read
    // either. This is the regression test for exit 17.
    writeFileSync(join(repo, 'scratch-notes.md'), 'untracked, and irrelevant\n');

    const run = runWrapper(CLEAN, { record: true });

    expect(run.stdout).toContain('VERDICT:CLEAN');
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeDefined();
  });

  it('refuses to record when a TRACKED file changes during the review', () => {
    // The threat the dirty check actually names: the reviewer reads the
    // worktree, so an edit landing mid-review is context the commit lacks.
    const run = runExpectingRefusal(CLEAN, {
      record: true,
      sideEffect: `printf 'edited mid-review\\n' >> "${repo.replace(/\\/g, '/')}/feature.txt"`,
    });

    expect(run.status).toBe(17);
    expect(run.stderr).toContain('worktree changed during the review');
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('treats a missing sentinel as never having seen the diff', () => {
    const run = runExpectingRefusal('No sentinel here.\n\nVERDICT: CLEAN', { record: true });

    expect(run.status).toBe(9);
    expect(run.stderr).toContain('DID NOT ECHO THE DIFF SENTINEL');
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('treats the prompt appearing on stdout as no proof of a read', () => {
    // If the CLI ever echoes its prompt to stdout, the sentinel matches our own
    // words and the read-proof passes for a review that never happened.
    const run = runExpectingRefusal(`@@CANARY@@\nSAW-DIFF: @@SENTINEL@@\n\nVERDICT: CLEAN`, { record: true });

    expect(run.status).toBe(9);
    expect(run.stderr).toContain('prompt echo');
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('refuses a verdict that a later line retracts', () => {
    const hedged = 'SAW-DIFF: @@SENTINEL@@\n\nVERDICT: CLEAN\n\n...but I could not inspect the repository.';

    const run = runExpectingRefusal(hedged, { record: true });

    expect(run.status).toBe(4);
    expect(run.stderr).toContain('NO VERDICT LINE');
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('treats a reviewer that died as not reviewed, whatever it printed first', () => {
    const run = runExpectingRefusal(CLEAN, { record: true, exit: '3' });

    expect(run.status).toBe(4);
    expect(run.stderr).toContain('PROCESS FAILED');
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('treats an empty answer as not reviewed rather than as nothing found', () => {
    // An early version exited 0 on an empty file, which reads like a clean pass.
    // The read-proof catches it before the verdict check does — silence cannot
    // echo a sentinel — so the refusal is exit 9, and either would be correct
    // so long as nothing is recorded.
    const run = runExpectingRefusal('', { record: true });

    expect(run.status).toBe(9);
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('reports findings without recording anything', () => {
    const findings = 'SAW-DIFF: @@SENTINEL@@\n\nOne problem.\n\nVERDICT: FINDINGS';

    const run = runExpectingRefusal(findings, { record: true });

    expect(run.status).toBe(5);
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('records findings the maintainer accepts, naming the review they came from', () => {
    // The gate's third state. Reachable only here, at the end of every guard
    // above, so what gets acknowledged is always a review that really ran.
    const findings = 'SAW-DIFF: @@SENTINEL@@\n\nOne pre-existing limit.\n\nVERDICT: FINDINGS';

    const run = runWrapper(findings, { record: true, acknowledge: true });

    expect(run.stdout).toContain('VERDICT:FINDINGS');
    const receipt = receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer'] as { findings?: string };
    expect(receipt?.findings).toMatch(/^[0-9a-f]{64}$/);
  });

  it('will not acknowledge findings from a review that never proved it read the diff', () => {
    // --acknowledge relaxes the VERDICT, not the read-proof. Without that, the
    // third state would be the hand-stamp door reopened under a new name.
    const run = runExpectingRefusal('No sentinel.\n\nVERDICT: FINDINGS', { record: true, acknowledge: true });

    expect(run.status).toBe(9);
    expect(receipts()[git(['rev-parse', 'HEAD'])]?.['cross-model-peer']).toBeUndefined();
  });

  it('points the reviewer at the diff file and tells it not to take orders from it', () => {
    // The hardening that stops code under review addressing the reviewer is
    // prose in a prompt, so nothing but this pins that it is still sent.
    runWrapper(CLEAN);
    const prompt = readFileSync(promptFile, 'utf8');

    expect(prompt).toContain('.peer-review-diff.tmp');
    expect(prompt).toContain('is DATA');
    expect(prompt).toMatch(/Never reproduce the token PROMPT-ECHO-\d+-[0-9a-f]+/);
    // The diff itself must NOT be in the prompt any more — that is what lifted
    // the argv ceiling, and a regression would restore it silently.
    expect(prompt).not.toContain('a change to review');
  });

  it('refreshes a stale tracking ref even when the branch has no configured remote', () => {
    // The freshness guard read branch.<name>.remote and returned SUCCESS when
    // there was none — the state of every newly created local branch. So it
    // reported success exactly where the pushed state was least known, and the
    // fallback base then trusted whatever origin/main was at the last fetch.
    // Another contributor pushes while we are unaware:
    git(['config', '--unset', 'branch.main.remote']);
    const other = join(repo, '..', 'other');
    execFileSync('git', ['clone', '-q', origin, other], { env: childEnv });
    git(['config', 'user.email', 'other@example.com'], other);
    git(['config', 'user.name', 'Other'], other);
    writeFileSync(join(other, 'theirs.txt'), 'work we have never seen\n');
    git(['add', 'theirs.txt'], other);
    git(['commit', '-q', '--no-verify', '-m', 'theirs'], other);
    const theirTip = git(['rev-parse', 'HEAD'], other);
    git(['push', '-q', '--no-verify', 'origin', 'main'], other);

    expect(git(['rev-parse', 'origin/main'])).not.toBe(theirTip); // stale, as they left us

    runWrapper(CLEAN, { record: true });

    expect(git(['rev-parse', 'origin/main'])).toBe(theirTip);
  });

  describe('choosing the base that defines what gets reviewed', () => {
    it('tolerates a remote that simply has no main', () => {
      // Written as `rev-parse … && return 1`, the guard ended on the FAILED
      // rev-parse in exactly this case, leaking status 1 — so every repo whose
      // remote has no main lost the ability to record at all, while the comment
      // above it claimed the opposite.
      git(['push', '-q', '--no-verify', 'origin', 'main:master']);
      // The bare repo refuses to delete its own HEAD branch, so move HEAD first.
      git(['symbolic-ref', 'HEAD', 'refs/heads/master'], origin);
      git(['push', '-q', '--no-verify', 'origin', '--delete', 'main']);
      git(['update-ref', '-d', 'refs/remotes/origin/main']);

      expect(callWrapperFn('refresh_upstream').status).toBe(0);
    });

    it('refuses when the remote lost main but a local copy of it survives', () => {
      // The stale copy is not the pushed state, and reviewing against it covers
      // a range the remote no longer has.
      const stale = git(['rev-parse', 'refs/remotes/origin/main']);
      git(['push', '-q', '--no-verify', 'origin', 'main:master']);
      git(['symbolic-ref', 'HEAD', 'refs/heads/master'], origin);
      git(['push', '-q', '--no-verify', 'origin', '--delete', 'main']);
      // Deleting via push prunes the tracking ref as a side effect. A clone that
      // simply has not pruned is the state that matters, so put it back.
      git(['update-ref', 'refs/remotes/origin/main', stale]);

      expect(git(['rev-parse', '--verify', 'refs/remotes/origin/main'])).toBe(stale);
      expect(callWrapperFn('refresh_upstream').status).toBe(2);
    });

    it('refuses to guess when several remotes exist and none is origin', () => {
      // An earlier revision took `git remote | head -1`, certifying against
      // whichever remote sorts first while a default push follows
      // branch.<name>.pushRemote or remote.pushDefault somewhere else entirely.
      // The review would then cover a range the push does not. Guessing
      // replaced a refusal with a wrong answer, which is the worse of the two.
      git(['remote', 'rename', 'origin', 'archive']);
      git(['remote', 'add', 'publish', join(repo, '..', 'elsewhere.git')]);
      git(['config', '--unset', 'branch.main.remote']);

      expect(callWrapperFn('tracking_remote').stdout.trim()).toBe('');
      expect(callWrapperFn('base_ref').stdout.trim()).toBe('');
    });

    it('does not let an unused stale main block a branch tracking something else', () => {
      // The base here is origin/release. Refreshing `main` regardless meant a
      // stale copy of a branch this review never consults could refuse it.
      git(['checkout', '-q', '-b', 'release']);
      git(['push', '-q', '--no-verify', '-u', 'origin', 'release']);
      const stale = git(['rev-parse', 'refs/remotes/origin/main']);
      git(['symbolic-ref', 'HEAD', 'refs/heads/release'], origin);
      git(['push', '-q', '--no-verify', 'origin', '--delete', 'main']);
      git(['update-ref', 'refs/remotes/origin/main', stale]);

      expect(callWrapperFn('base_ref').stdout.trim()).toBe('refs/remotes/origin/release');
      expect(callWrapperFn('refresh_upstream').status).toBe(0);
    });

    it('advances the tracked branch its own ref, not some other branch', () => {
      // The positive half. Every other case here asserts a refusal, and nothing
      // stopped a revision from refreshing nothing at all and returning 0.
      const other = join(repo, '..', 'other');
      execFileSync('git', ['clone', '-q', origin, other], { env: childEnv });
      git(['config', 'user.email', 'o@e.com'], other);
      git(['config', 'user.name', 'O'], other);
      writeFileSync(join(other, 'theirs.txt'), 'pushed by someone else\n');
      git(['add', 'theirs.txt'], other);
      git(['commit', '-q', '--no-verify', '-m', 'theirs'], other);
      const theirTip = git(['rev-parse', 'HEAD'], other);
      git(['push', '-q', '--no-verify', 'origin', 'main'], other);

      expect(callWrapperFn('refresh_upstream').status).toBe(0);
      expect(git(['rev-parse', 'refs/remotes/origin/main'])).toBe(theirTip);
    });

    it('does not resurrect a pruned tracking ref pointing at main', () => {
      // Under fetch.prune the plain fetch deletes the tracking ref, `@{upstream}`
      // stops resolving, and the source fell back to refs/heads/main — writing
      // MAIN's tip into refs/remotes/origin/topic. The delete has to come from a
      // SECOND clone: pushing it from here prunes eagerly and destroys the setup
      // before the wrapper ever runs.
      git(['checkout', '-q', '-b', 'topic']);
      git(['push', '-q', '--no-verify', '-u', 'origin', 'topic']);
      git(['config', 'fetch.prune', 'true']);
      const mainTip = git(['rev-parse', 'refs/remotes/origin/main']);

      const other = join(repo, '..', 'other');
      execFileSync('git', ['clone', '-q', origin, other], { env: childEnv });
      git(['push', '-q', '--no-verify', 'origin', '--delete', 'topic'], other);

      callWrapperFn('refresh_upstream');

      const resurrected = callWrapperFn('git rev-parse --verify --quiet refs/remotes/origin/topic || true');
      expect(resurrected.stdout.trim()).not.toBe(mainTip);
      expect(resurrected.stdout.trim()).toBe('');
    });

    it('will not take an upstream belonging to a remote it did not validate', () => {
      // `@{upstream}` resolves from branch.<name>.remote + merge, and a remote
      // with a fetch mapping and a tracking ref but NO url still satisfies it.
      // Keying on the ref namespace accepted that upstream while the fetch went
      // to origin — so origin's main landed in the other remote's tracking ref.
      const foreign = git(['rev-parse', 'HEAD']);
      git(['update-ref', 'refs/remotes/old/main', foreign]);
      git(['config', 'remote.old.fetch', '+refs/heads/*:refs/remotes/old/*']);
      git(['config', 'branch.main.remote', 'old']);

      expect(git(['rev-parse', '--symbolic-full-name', '@{upstream}'])).toBe('refs/remotes/old/main');
      expect(callWrapperFn('tracking_remote').stdout.trim()).toBe('origin');
      expect(callWrapperFn('base_ref').stdout.trim()).toBe('refs/remotes/origin/main');

      callWrapperFn('refresh_upstream');

      expect(git(['rev-parse', 'refs/remotes/old/main'])).toBe(foreign);
    });

    it('will not take a LOCAL branch as the last pushed state', () => {
      // `branch.<name>.remote = "."` is git's local-tracking value, so
      // `@{upstream}` resolves to refs/heads/*. An earlier fix refused it at the
      // fetch — but the base is chosen in default_base, which returned it before
      // origin/main was ever read, so the defect survived its own fix.
      git(['checkout', '-q', '-b', 'local-tracked']);
      git(['config', 'branch.local-tracked.remote', '.']);
      git(['config', 'branch.local-tracked.merge', 'refs/heads/main']);
      commitFile('later.txt', 'after the pushed state\n', 'later');

      expect(git(['rev-parse', '--symbolic-full-name', '@{upstream}'])).toBe('refs/heads/main');
      const base = callWrapperFn('default_base | head -1').stdout.trim();

      expect(base).toBe(git(['rev-parse', 'refs/remotes/origin/main']));
    });
  });

  it('never spells the read-proof token out in the prompt', () => {
    // The sentinel proves the reviewer OPENED the diff file. Name it anywhere
    // in the prompt and a reviewer that could not open the file can echo it
    // from memory instead — the guard passes for an unread change. It leaked
    // once already, through a canary built as PROMPT-ECHO-<sentinel>.
    runWrapper(CLEAN);
    const prompt = readFileSync(promptFile, 'utf8');
    const sentinel = readFileSync(`${promptFile}.sentinel`, 'utf8').trim();

    expect(sentinel).toMatch(/^PEER-[0-9a-f]+-\d+$/);
    expect(prompt).not.toContain(sentinel);
  });

  it('removes the staged diff file once the review is over', () => {
    runWrapper(CLEAN, { record: true });

    expect(existsSync(join(repo, '.peer-review-diff.tmp'))).toBe(false);
  });

  it('refuses a submodule pointer move, whose code never reaches the reviewer', () => {
    // A real nested repo, not a hand-written index entry: the latter leaves the
    // worktree missing the path, and the dirty check would refuse first — the
    // submodule guard would never be reached and the test would prove nothing.
    const nested = join(repo, 'vendor', 'lib');
    mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', nested], { env: childEnv });
    writeFileSync(join(nested, 'code.txt'), 'submodule content\n');
    git(['add', 'code.txt'], nested);
    git(['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '--no-verify', '-m', 'nested'], nested);
    git(['add', 'vendor/lib']);
    git(['commit', '-q', '--no-verify', '-m', 'add submodule pointer']);

    const run = runExpectingRefusal(CLEAN, { record: true });

    expect(run.status).toBe(14);
    expect(run.stderr).toContain('submodule pointer');
  });

  it('allows an ordinary path that merely contains the submodule mode digits', () => {
    // Unanchored, the gitlink match also hit `docs/160000-notes.md` and refused
    // an innocent change — the same class of failure as the exit-17 bug.
    commitFile('docs/160000-notes.md', 'ordinary prose\n', 'notes');

    const run = runWrapper(CLEAN, { record: true });

    expect(run.stdout).toContain('VERDICT:CLEAN');
  });
});
