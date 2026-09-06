import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The SessionStart hook is the mechanism that puts the heartbeat contract in
 * front of every session, so the two ways it can silently do nothing are
 * exercised through the real settings file and the real command.
 *
 * Hooks run in the session's CURRENT directory, and SessionStart fires again
 * on compaction, resume, clear and fork — by which time a session may have
 * changed directory. A command that resolves the script relative to that
 * directory fails with MODULE_NOT_FOUND, and a SessionStart failure is
 * non-blocking, so the session simply continues without the contract.
 */
const ROOT = resolve('.');

// Spawning bash on a loaded machine can alone exceed jest's 5s default.
jest.setTimeout(30_000);

interface CommandHook {
  type: string;
  command: string;
}

interface HookGroup {
  hooks: CommandHook[];
}

interface Settings {
  hooks: { SessionStart: HookGroup[] };
}

function sessionStartCommand(): string {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8')) as Settings;
  const commands = settings.hooks.SessionStart.flatMap((group) => group.hooks)
    .filter((hook) => hook.type === 'command')
    .map((hook) => hook.command);
  expect(commands).toHaveLength(1);
  return commands[0];
}

function runHookFrom(cwd: string): string {
  return execFileSync('bash', ['-c', sessionStartCommand()], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('SessionStart heartbeat hook', () => {
  it('emits the heartbeat contract when the session is not in the project root', () => {
    const output = runHookFrom(join(ROOT, 'src'));

    expect(output).toContain('HEARTBEAT CONTRACT');
  });

  it('names CronList before CronCreate, a tripwire that the existence check precedes the arm', () => {
    const output = runHookFrom(ROOT);

    const list = output.indexOf('CronList');
    const create = output.indexOf('CronCreate');
    expect(list).toBeGreaterThan(-1);
    expect(list).toBeLessThan(create);
  });
});
