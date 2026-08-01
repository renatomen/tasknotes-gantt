import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/vault-as-code.mjs');

interface VaultFixture {
  folders: string[];
  notes: Array<{ p: string; fm: string }>;
  bases: Array<{ p: string; c: string }>;
  pluginConfigs: Array<{ p: string; c: string }>;
  stats: {
    folders: number;
    notes: number;
    notesWithFm: number;
    bases: number;
    pluginConfigs: number;
  };
}

let root: string;
let vaultPath: string;
let fixturePath: string;

function writeVaultFile(relativePath: string, content: string): void {
  const target = join(vaultPath, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function extractFixture(): VaultFixture {
  execFileSync(process.execPath, [SCRIPT, 'extract', vaultPath, fixturePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as VaultFixture;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vault-as-code-scan-'));
  vaultPath = join(root, 'source-vault');
  fixturePath = join(root, 'fixture.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('vault-as-code extract scan', () => {
  it('captures nested folders and supported files without note bodies', () => {
    const frontmatter = '---\nstatus: open\n---';
    const baseContent = 'views:\r\n  - type: table\r\n';
    mkdirSync(join(vaultPath, 'Project', 'Milestone'), { recursive: true });
    writeVaultFile('Project/Milestone/Task.MD', `${frontmatter}\nprivate body\n`);
    writeVaultFile('Project/Milestone/Roadmap.BASE', baseContent);
    writeVaultFile('Project/Milestone/attachment.png', 'ignored');

    const fixture = extractFixture();

    expect(fixture.folders).toEqual(['Project', 'Project/Milestone']);
    expect(fixture.notes).toEqual([{ p: 'Project/Milestone/Task.MD', fm: frontmatter }]);
    expect(fixture.bases).toEqual([{ p: 'Project/Milestone/Roadmap.BASE', c: baseContent }]);
    expect(fixture.pluginConfigs).toEqual([]);
    expect(fixture.stats).toEqual({
      folders: 2,
      notes: 1,
      notesWithFm: 1,
      bases: 1,
      pluginConfigs: 0,
    });
  });

  it('skips only the exact case-sensitive excluded directory names', () => {
    const skippedDirectories = ['.obsidian', '.trash', '.git', 'node_modules', '.smart-env'];
    for (const directory of skippedDirectories) {
      writeVaultFile(`Included/${directory}/Excluded.md`, '---\nstatus: hidden\n---\n');
    }
    writeVaultFile('Included/.custom/Kept.md', '');

    const fixture = extractFixture();

    for (const directory of skippedDirectories) {
      expect(fixture.folders).not.toContain(`Included/${directory}`);
      expect(fixture.notes).not.toContainEqual(
        expect.objectContaining({ p: `Included/${directory}/Excluded.md` }),
      );
    }
    expect(fixture.folders).toEqual(
      expect.arrayContaining(['Included', 'Included/.custom']),
    );
    expect(fixture.notes).toContainEqual({ p: 'Included/.custom/Kept.md', fm: '' });
  });

  it('does not skip a case variant of an excluded directory name', () => {
    writeVaultFile('Included/.OBSIDIAN/Kept.md', '');

    const fixture = extractFixture();

    expect(fixture.folders).toEqual(['Included', 'Included/.OBSIDIAN']);
    expect(fixture.notes).toEqual([{ p: 'Included/.OBSIDIAN/Kept.md', fm: '' }]);
  });

  it('extracts a missing vault path as an empty scan', () => {
    const fixture = extractFixture();

    expect(fixture.folders).toEqual([]);
    expect(fixture.notes).toEqual([]);
    expect(fixture.bases).toEqual([]);
    expect(fixture.stats).toEqual({
      folders: 0,
      notes: 0,
      notesWithFm: 0,
      bases: 0,
      pluginConfigs: 0,
    });
  });
});
