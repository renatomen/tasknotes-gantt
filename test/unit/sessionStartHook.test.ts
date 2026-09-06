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
 * Hooks run in the session's CURRENT directory, and SessionStart fires again
 * on compaction, resume, clear and fork — by which time a session may have
 * changed directory. A command that resolves a script relative to that
 * directory fails with MODULE_NOT_FOUND, and a SessionStart failure is
 * non-blocking, so the session simply continues without the contract. The
 * heartbeat the contract asks for fires later still, from wherever the
 * session's shell is by then — possibly no repository at all — and that shell
 * does not carry the hook's CLAUDE_PROJECT_DIR.
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

describe('SessionStart heartbeat hook', () => {
  it('emits the heartbeat contract when the session is not in the project root', () => {
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

  it('names CronList before CronCreate, a tripwire that the existence check precedes the arm', () => {
    const output = runHookFrom(ROOT);

    const list = output.indexOf('CronList');
    const create = output.indexOf('CronCreate');
    expect(list).toBeGreaterThan(-1);
    expect(list).toBeLessThan(create);
  });

  it('binds every numbered heartbeat step to the root the session started in', () => {
    const output = runHookFrom(SUBDIRECTORY);

    const steps = output.split('\n').filter((line) => /^\s+\d+\. /.test(line));
    expect(steps.length).toBeGreaterThanOrEqual(4);
    for (const step of steps) {
      expect(step).toMatch(new RegExp(`^\\s+\\d+\\. cd "${ROOT_FROM_HOOK}" && `));
    }
    expect(output).toContain(receiptCheckCommand(ROOT_FROM_HOOK));
  });

  it('names the report VERDICT line, not the receipt, as the signal that the review finished', () => {
    const contract = heartbeatContract(ROOT_FROM_HOOK);

    const verdict = contract.indexOf('VERDICT: CLEAN|FINDINGS');
    const receipt = contract.indexOf('receipt');
    expect(verdict).toBeGreaterThan(-1);
    expect(contract).not.toMatch(/recording the receipt/);
    expect(receipt).toBeGreaterThan(-1);
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
