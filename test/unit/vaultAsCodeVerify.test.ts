import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/vault-as-code.mjs');
const EMPTY_PATH_REPORT = [
  '[verify] folders: orig=0 gen=0 miss=0 extra=0',
  '[verify] notes:   orig=0 gen=0 miss=0 extra=0',
  '[verify] bases:   orig=0 gen=0 miss=0 extra=0',
  '[verify] frontmatter mismatches: 0',
];
const PASS_LINE = '[verify] PASS — generated vault is indistinguishable from original (except bodies)';
const FAIL_LINE = '[verify] FAIL — see diffs above';

interface VaultFixture {
  schema: string;
  sourceBasename: string;
  folders: string[];
  notes: Array<{ p: string; fm: string }>;
  bases: Array<{ p: string; c: string }>;
  pluginConfigs: Array<{ p: string; c: string }>;
}

interface VerifyRun {
  status: number;
  lines: string[];
  stderr: string;
  tempPath: string;
}

let root: string;
let vaultPath: string;
let fixturePath: string;
let childTempPaths: string[];

function writeVaultFile(relativePath: string, content: string): void {
  const target = join(vaultPath, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function writeFixture(overrides: Partial<VaultFixture> = {}): void {
  const fixture: VaultFixture = {
    schema: 'vault-as-code/2',
    sourceBasename: 'source-vault',
    folders: [],
    notes: [],
    bases: [],
    pluginConfigs: [],
    ...overrides,
  };
  writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
}

function runVerify(): VerifyRun {
  const result = spawnSync(process.execPath, [SCRIPT, 'verify', fixturePath, vaultPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tempPath = join(tmpdir(), `vac-verify-${result.pid}`);
  childTempPaths.push(tempPath);
  const stdout = (result.stdout ?? '').trimEnd();
  return {
    status: result.status ?? -1,
    lines: stdout ? stdout.split(/\r?\n/) : [],
    stderr: result.stderr ?? '',
    tempPath,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vault-as-code-verify-'));
  vaultPath = join(root, 'source-vault');
  fixturePath = join(root, 'fixture.json');
  childTempPaths = [];
  mkdirSync(vaultPath, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const tempPath of childTempPaths) {
    rmSync(tempPath, { recursive: true, force: true });
  }
});

describe('vault-as-code verify', () => {
  it('passes when only ignored content and normalized line endings differ', () => {
    const frontmatter = '---\nstatus: open\n---';
    writeFixture({
      folders: ['Project'],
      notes: [{ p: 'Project/Task.md', fm: frontmatter }],
      bases: [{ p: 'Project/View.base', c: 'generated base content\n' }],
    });
    writeVaultFile('Project/Task.md', '---\r\nstatus: open\r\n---\r\nprivate note body\r\n');
    writeVaultFile('Project/View.base', 'different source base content\n');

    const run = runVerify();

    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.lines).toEqual([
      '[verify] folders: orig=1 gen=1 miss=0 extra=0',
      '[verify] notes:   orig=1 gen=1 miss=0 extra=0',
      '[verify] bases:   orig=1 gen=1 miss=0 extra=0',
      '[verify] frontmatter mismatches: 0',
      '[verify] pluginConfigs: 0 captured, mismatches=0, secretLeaks=0',
      PASS_LINE,
    ]);
    expect(existsSync(run.tempPath)).toBe(false);
  });

  it('reports missing and extra paths before exiting with status two', () => {
    writeFixture({
      folders: ['Generated'],
      notes: [{ p: 'Generated/Extra.md', fm: '' }],
      bases: [{ p: 'Generated/Extra.base', c: '' }],
    });
    writeVaultFile('Original/Missing.md', '');
    writeVaultFile('Original/Missing.base', '');

    const run = runVerify();

    expect(run.status).toBe(2);
    expect(run.lines).toEqual([
      '[verify] folders: orig=1 gen=1 miss=1 extra=1',
      '[verify] notes:   orig=1 gen=1 miss=1 extra=1',
      '[verify] bases:   orig=1 gen=1 miss=1 extra=1',
      '[verify] frontmatter mismatches: 0',
      '[verify] pluginConfigs: 0 captured, mismatches=0, secretLeaks=0',
      '[verify] sample missing notes: Original/Missing.md',
      FAIL_LINE,
    ]);
    expect(existsSync(run.tempPath)).toBe(false);
  });

  it('reports frontmatter mismatches for shared note paths', () => {
    writeFixture({
      folders: ['Project'],
      notes: [{ p: 'Project/Task.md', fm: '---\nstatus: open\n---' }],
    });
    writeVaultFile('Project/Task.md', '---\nstatus: closed\n---\n');

    const run = runVerify();

    expect(run.status).toBe(2);
    expect(run.lines).toEqual([
      '[verify] folders: orig=1 gen=1 miss=0 extra=0',
      '[verify] notes:   orig=1 gen=1 miss=0 extra=0',
      '[verify] bases:   orig=0 gen=0 miss=0 extra=0',
      '[verify] frontmatter mismatches: 1 e.g. Project/Task.md',
      '[verify] pluginConfigs: 0 captured, mismatches=0, secretLeaks=0',
      FAIL_LINE,
    ]);
  });

  it('accepts every supported empty representation for TaskNotes secrets', () => {
    writeFixture({
      pluginConfigs: [
        {
          p: '.obsidian/plugins/tasknotes/data.json',
          c: JSON.stringify({
            apiAuthToken: '',
            googleOAuthClientId: null,
            googleCalendarSyncTokens: [],
            webhooks: {},
          }),
        },
      ],
    });

    const run = runVerify();

    expect(run.status).toBe(0);
    expect(run.lines).toEqual([
      ...EMPTY_PATH_REPORT,
      '[verify] pluginConfigs: 1 captured, mismatches=0, secretLeaks=0',
      PASS_LINE,
    ]);
  });

  it('reports nonempty TaskNotes secrets in configured-key order', () => {
    writeFixture({
      pluginConfigs: [
        {
          p: '.obsidian/plugins/tasknotes/data.json',
          c: JSON.stringify({
            webhooks: { url: 'secret' },
            googleCalendarSyncTokens: ['secret'],
            apiAuthToken: 'secret',
          }),
        },
      ],
    });

    const run = runVerify();

    expect(run.status).toBe(2);
    expect(run.lines).toEqual([
      ...EMPTY_PATH_REPORT,
      '[verify] pluginConfigs: 1 captured, mismatches=0, secretLeaks=3 e.g. SECRET:apiAuthToken, SECRET:googleCalendarSyncTokens, SECRET:webhooks',
      FAIL_LINE,
    ]);
  });

  it('reports an earlier duplicate plugin config overwritten during generation', () => {
    const pluginPath = '.obsidian/plugins/example/data.json';
    writeFixture({
      pluginConfigs: [
        { p: pluginPath, c: 'first' },
        { p: pluginPath, c: 'second' },
      ],
    });

    const run = runVerify();

    expect(run.status).toBe(2);
    expect(run.lines).toEqual([
      ...EMPTY_PATH_REPORT,
      `[verify] pluginConfigs: 2 captured, mismatches=1, secretLeaks=0 e.g. ${pluginPath}`,
      FAIL_LINE,
    ]);
  });

  it('does not compare fixture plugin config with the source vault config', () => {
    writeFixture({
      pluginConfigs: [
        {
          p: '.obsidian/plugins/tasknotes/data.json',
          c: JSON.stringify({ apiAuthToken: '' }),
        },
      ],
    });
    writeVaultFile(
      '.obsidian/plugins/tasknotes/data.json',
      JSON.stringify({ apiAuthToken: 'source-only secret' }),
    );

    const run = runVerify();

    expect(run.status).toBe(0);
    expect(run.lines).toEqual([
      ...EMPTY_PATH_REPORT,
      '[verify] pluginConfigs: 1 captured, mismatches=0, secretLeaks=0',
      PASS_LINE,
    ]);
  });

  it('keeps unparseable TaskNotes config outside secret-value checks', () => {
    writeFixture({
      pluginConfigs: [
        {
          p: '.obsidian/plugins/tasknotes/data.json',
          c: '{"apiAuthToken":"not closed"',
        },
      ],
    });

    const run = runVerify();

    expect(run.status).toBe(0);
    expect(run.lines).toEqual([
      ...EMPTY_PATH_REPORT,
      '[verify] pluginConfigs: 1 captured, mismatches=0, secretLeaks=0',
      PASS_LINE,
    ]);
  });
});
