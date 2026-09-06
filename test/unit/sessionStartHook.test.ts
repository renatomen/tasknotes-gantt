import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { heartbeatContract, projectRoot, receiptCheckCommand } from '../../scripts/session-start-context.mjs';

/**
 * The SessionStart hook is the mechanism that puts the heartbeat contract in
 * front of every session, so the ways it can silently do nothing are
 * exercised through the real settings file and the real commands.
 *
 * Claude Code reads the project settings from the directory the session
 * started in, so the hook serves sessions started at the repository root.
 * Hooks then run in the session's CURRENT directory, and SessionStart fires
 * again on compaction, resume, clear and fork — by which time a session may
 * have changed directory. A command that resolves a script relative to that
 * directory fails with MODULE_NOT_FOUND, and a SessionStart failure is
 * non-blocking, so the session simply continues without the contract. The
 * heartbeat the contract asks for fires later still, from wherever the
 * session's shell is by then — possibly no repository at all — and that shell
 * does not carry the hook's CLAUDE_PROJECT_DIR.
 *
 * The contract itself is prose an agent follows; the pins on it are tripwires
 * on the markers and sentences that carry each rule, named as such.
 */
const ROOT = resolve('.');
const SUBDIRECTORY = join(ROOT, 'src');
const OUTSIDE_ANY_REPOSITORY = tmpdir();
const ROOT_FROM_HOOK = projectRoot({ CLAUDE_PROJECT_DIR: ROOT });

type ShellEnvironment = Record<string, string | undefined>;

// Spawning bash on a loaded machine can alone exceed jest's 5s default.
jest.setTimeout(30_000);

interface CommandHook {
  type: string;
  command: string;
}

interface HookGroup {
  matcher?: string;
  hooks: CommandHook[];
}

interface Settings {
  hooks: { SessionStart: HookGroup[] };
}

function sessionStartGroups(): HookGroup[] {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8')) as Settings;
  return settings.hooks.SessionStart;
}

function sessionStartCommand(): string {
  const commands = sessionStartGroups()
    .flatMap((group) => group.hooks)
    .filter((hook) => hook.type === 'command')
    .map((hook) => hook.command);
  expect(commands).toHaveLength(1);
  return commands[0];
}

function withoutHookEnvironment(): ShellEnvironment {
  const { CLAUDE_PROJECT_DIR: _dropped, ...shellEnv } = process.env;
  return shellEnv;
}

function runHookFrom(cwd: string, env: ShellEnvironment = { ...process.env, CLAUDE_PROJECT_DIR: ROOT }): string {
  return execFileSync('bash', ['-c', sessionStartCommand()], {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Claude Code hands every hook a JSON event on stdin; `source` says how the session started. */
function runHookWithEvent(event: Record<string, string>): string {
  return execFileSync('bash', ['-c', sessionStartCommand()], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    input: JSON.stringify(event),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function positionOf(text: string, marker: string): number {
  const position = text.indexOf(marker);
  expect(position).toBeGreaterThan(-1);
  return position;
}

function numberedSteps(text: string): string[] {
  return text.split('\n').filter((line) => /^\s+\d+\. /.test(line));
}

describe('SessionStart heartbeat hook', () => {
  it('emits the heartbeat contract after a root-started session changed directory', () => {
    const output = runHookFrom(SUBDIRECTORY);

    expect(output).toContain('HEARTBEAT CONTRACT');
  });

  it('emits the heartbeat contract without the hook environment, from inside the repository', () => {
    const output = runHookFrom(SUBDIRECTORY, withoutHookEnvironment());

    expect(output).toContain(receiptCheckCommand(ROOT_FROM_HOOK));
  });

  it('fires on every SessionStart source, so no matcher narrows re-arming', () => {
    for (const group of sessionStartGroups()) {
      expect(group.matcher).toBeUndefined();
    }
  });

  it('orders CronList, CronDelete, CronCreate, a tripwire that the check and the sweep precede the arm', () => {
    const output = runHookFrom(ROOT);

    const list = positionOf(output, 'CronList');
    const sweep = positionOf(output, 'CronDelete');
    const create = positionOf(output, 'CronCreate');
    expect(list).toBeLessThan(sweep);
    expect(sweep).toBeLessThan(create);
  });

  it('binds every numbered heartbeat step, reads and writes alike, to the root the session started in', () => {
    const output = runHookFrom(SUBDIRECTORY);

    const steps = numberedSteps(output);
    expect(steps.length).toBeGreaterThanOrEqual(8);
    for (const step of steps) {
      expect(step).toMatch(new RegExp(`^\\s+\\d+\\. cd "${ROOT_FROM_HOOK}" && `));
    }
    expect(output).toContain(receiptCheckCommand(ROOT_FROM_HOOK));
    for (const write of ['git push', 'gh pr merge', 'record ce-code-review', 'cross-model-peer-review.sh']) {
      expect(steps.some((step) => step.includes(write))).toBe(true);
    }
  });

  it('merges only the head it observed and records layer one against the reviewed commit', () => {
    const steps = numberedSteps(heartbeatContract(ROOT_FROM_HOOK));

    expect(steps.find((step) => step.includes('gh pr merge'))).toContain('--match-head-commit');
    expect(steps.find((step) => step.includes('record ce-code-review'))).toContain('<reviewed-sha>');
  });

  it('launches the peer wrapper without acknowledging, a tripwire that findings are read before accepted', () => {
    const contract = heartbeatContract(ROOT_FROM_HOOK);

    const launch = numberedSteps(contract).find((step) => step.includes('cross-model-peer-review.sh'));
    expect(launch).not.toContain('--acknowledge');
    expect(contract).toContain('only after reading the findings');
  });

  it('pins the two completion-signal sentences: the VERDICT line ends the review, the receipt closes the gate', () => {
    const contract = heartbeatContract(ROOT_FROM_HOOK);

    expect(contract).toContain('VERDICT line is the signal that the review finished');
    expect(contract).toContain('receipt is the signal that the gate accepted it');
    expect(contract).not.toMatch(/recording the receipt/);
  });

  it('forbids the foreground wait, a tripwire on the sentence that keeps the heartbeat able to fire', () => {
    const contract = heartbeatContract(ROOT_FROM_HOOK);

    expect(contract).toContain('never in the foreground');
    expect(contract).toContain('fire only while the REPL is idle');
  });

  it('treats a round as refused only when neither codex nor the wrapper is alive, a tripwire on the condition', () => {
    const contract = heartbeatContract(ROOT_FROM_HOOK);

    const hung = positionOf(contract, 'is still running');
    const refused = positionOf(contract, "nor a wrapper bash whose arguments name this round's report file");
    expect(hung).toBeLessThan(refused);
  });

  it('forbids push and merge after compaction, the charter checkpoint rule, keyed on the event source', () => {
    const compacted = runHookWithEvent({ source: 'compact' });
    const started = runHookWithEvent({ source: 'startup' });

    expect(compacted).toContain('CONTEXT WAS COMPACTED');
    expect(compacted).toContain('do not push or merge');
    expect(started).not.toContain('CONTEXT WAS COMPACTED');
  });

  it('reaches the receipt gate from outside any repository, without the hook environment', () => {
    const command = receiptCheckCommand(ROOT_FROM_HOOK);

    const result = spawnSync('bash', ['-c', command], {
      cwd: OUTSIDE_ANY_REPOSITORY,
      encoding: 'utf8',
      env: withoutHookEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // The developer's own receipt store decides which branch of the gate's
    // protocol answers; either is a real answer, and nothing else is.
    expect([0, 1]).toContain(result.status);
    const protocol =
      result.status === 0
        ? /^review receipts OK for [0-9a-f]{7}/m
        : /^pre-push: missing clean review receipts for [0-9a-f]{7}/m;
    expect(`${result.stdout}${result.stderr}`).toMatch(protocol);
  });
});

describe('projectRoot', () => {
  it('falls back to the repository top level when the hook environment is absent', () => {
    expect(projectRoot({})).toBe(ROOT_FROM_HOOK);
  });

  it('treats an empty hook value as absent', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: '' })).toBe(projectRoot({}));
  });

  it('normalizes a backslash path to forward slashes', () => {
    expect(projectRoot({ CLAUDE_PROJECT_DIR: 'C:\\work\\repo' })).toBe('C:/work/repo');
  });
});
