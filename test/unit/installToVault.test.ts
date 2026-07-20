/**
 * The vault-install step is the mechanism that guarantees every build lands in
 * a developer's test vault (it runs from Vite's `closeBundle`, so no build path
 * can skip it). It had no coverage — these tests pin the guarantee and the
 * never-clobber / never-throw contract.
 */
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain .mjs build script, no types
import { installToVault, parseVaults } from '../../scripts/install-to-vault.mjs';

const silent = { log: () => {}, warn: () => {} };

let root: string;
let distDir: string;
let vault: string;

const pluginDir = (): string => path.join(vault, '.obsidian', 'plugins', 'tasknotes-gantt');
const read = (file: string): string => fs.readFileSync(path.join(pluginDir(), file), 'utf8');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-install-'));
  distDir = path.join(root, 'dist');
  vault = path.join(root, 'vault');
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'main.js'), 'BUILT', 'utf8');
  fs.writeFileSync(path.join(distDir, 'manifest.json'), '{"id":"tasknotes-gantt"}', 'utf8');
  fs.writeFileSync(path.join(distDir, 'styles.css'), '.x{}', 'utf8');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('installToVault', () => {
  it('copies the built files into the vault plugin directory', () => {
    expect(installToVault({ distDir, vault, log: silent })).toBe('installed');
    expect(read('main.js')).toBe('BUILT');
    expect(read('styles.css')).toBe('.x{}');
    expect(read('manifest.json')).toContain('tasknotes-gantt');
  });

  it('overwrites a stale build, so a rebuild always wins', () => {
    installToVault({ distDir, vault, log: silent });
    fs.writeFileSync(path.join(distDir, 'main.js'), 'REBUILT', 'utf8');
    installToVault({ distDir, vault, log: silent });
    expect(read('main.js')).toBe('REBUILT');
  });

  it('writes the hot-reload marker so a running Obsidian picks the build up', () => {
    installToVault({ distDir, vault, log: silent });
    expect(fs.existsSync(path.join(pluginDir(), '.hotreload'))).toBe(true);
  });

  it('never clobbers existing settings or the marker', () => {
    installToVault({ distDir, vault, log: silent });
    fs.writeFileSync(path.join(pluginDir(), 'data.json'), '{"kept":true}', 'utf8');
    installToVault({ distDir, vault, log: silent });
    expect(read('data.json')).toBe('{"kept":true}');
  });

  it('skips silently when no vault is configured', () => {
    expect(installToVault({ distDir, vault: undefined, log: silent })).toBe('skipped:unset');
    expect(installToVault({ distDir, vault: '   ', log: silent })).toBe('skipped:unset');
  });

  it('skips a configured-but-missing vault instead of creating a phantom one', () => {
    const missing = path.join(root, 'gone');
    expect(installToVault({ distDir, vault: missing, log: silent })).toBe('skipped:missing');
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('continues when a build artifact is absent (never fails the build)', () => {
    fs.rmSync(path.join(distDir, 'styles.css'));
    expect(installToVault({ distDir, vault, log: silent })).toBe('installed');
    expect(read('main.js')).toBe('BUILT');
  });

  describe('multiple vaults', () => {
    // A developer testing in more than one vault (a small fixture vault AND a
    // realistic one) must not have to remember which build went where.
    it('installs into every configured vault', () => {
      const second = path.join(root, 'vault-two');
      fs.mkdirSync(second, { recursive: true });
      expect(installToVault({ distDir, vault: `${vault};${second}`, log: silent })).toBe('installed');
      for (const target of [vault, second]) {
        const installed = path.join(target, '.obsidian', 'plugins', 'tasknotes-gantt', 'main.js');
        expect(fs.readFileSync(installed, 'utf8')).toBe('BUILT');
      }
    });

    it('still installs the reachable vaults when one path is stale', () => {
      const missing = path.join(root, 'gone');
      expect(installToVault({ distDir, vault: `${missing};${vault}`, log: silent })).toBe('installed');
      expect(read('main.js')).toBe('BUILT');
      expect(fs.existsSync(missing)).toBe(false);
    });

    it('tolerates whitespace and trailing separators', () => {
      expect(parseVaults(` ${vault} ; `)).toEqual([vault]);
      expect(parseVaults(undefined)).toEqual([]);
      expect(parseVaults('   ')).toEqual([]);
    });
  });
});
